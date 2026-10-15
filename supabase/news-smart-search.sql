-- Strategic Owl admin article search
-- Run once in the Supabase SQL Editor before deploying the matching news-admin function.

alter table public.news_items
  add column if not exists search_vector tsvector;

create or replace function public.set_news_item_search_vector()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.headline, '')), 'A') ||
    setweight(
      to_tsvector('english', coalesce(array_to_string(new.categories, ' '), '')),
      'A'
    ) ||
    setweight(to_tsvector('english', coalesce(new.summary_text, '')), 'B') ||
    setweight(
      to_tsvector('english', coalesce(array_to_string(new.authors, ' '), '')),
      'C'
    );
  return new;
end;
$$;

drop trigger if exists news_items_set_search_vector on public.news_items;
create trigger news_items_set_search_vector
before insert or update of headline, summary_text, categories, authors
on public.news_items
for each row
execute function public.set_news_item_search_vector();

update public.news_items
set search_vector =
  setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
  setweight(
    to_tsvector('english', coalesce(array_to_string(categories, ' '), '')),
    'A'
  ) ||
  setweight(to_tsvector('english', coalesce(summary_text, '')), 'B') ||
  setweight(
    to_tsvector('english', coalesce(array_to_string(authors, ' '), '')),
    'C'
  )
where search_vector is null;

create index if not exists news_items_search_vector_idx
on public.news_items using gin (search_vector);

create index if not exists news_story_cluster_items_news_item_idx
on public.news_story_cluster_items (news_item_id, membership_status);

create or replace function public.search_news_items_admin(
  p_search text,
  p_status text default 'active',
  p_source_id uuid default null,
  p_item_ids uuid[] default null,
  p_before timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  source_id uuid,
  headline text,
  canonical_url text,
  authors text[],
  categories text[],
  published_at timestamptz,
  summary_text text,
  content_type text,
  primary_media_type text,
  primary_media_url text,
  thumbnail_url text,
  status text,
  is_pinned boolean,
  article_access_override text,
  created_at timestamptz,
  updated_at timestamptz,
  match_score double precision,
  matched_fields text[],
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with search_input as (
    select
      nullif(btrim(p_search), '') as normalized,
      websearch_to_tsquery('english', nullif(btrim(p_search), '')) as strict_query,
      websearch_to_tsquery(
        'english',
        regexp_replace(nullif(btrim(p_search), ''), '\s+', ' OR ', 'g')
      ) as broad_query
  ),
  candidates as (
    select
      item.id,
      item.source_id,
      item.headline,
      item.canonical_url,
      item.authors,
      item.categories,
      item.published_at,
      item.summary_text,
      item.content_type,
      item.primary_media_type,
      item.primary_media_url,
      item.thumbnail_url,
      item.status,
      item.is_pinned,
      item.article_access_override,
      item.created_at,
      item.updated_at,
      item.search_vector,
      source.source_name,
      coalesce(coverage.titles, '') as coverage_titles,
      input.normalized,
      input.strict_query,
      input.broad_query,
      to_tsvector('english', coalesce(source.source_name, '')) as source_vector,
      to_tsvector('english', coalesce(coverage.titles, '')) as coverage_vector
    from public.news_items as item
    join public.news_sources as source on source.id = item.source_id
    cross join search_input as input
    left join lateral (
      select string_agg(distinct cluster.title, ' ') as titles
      from public.news_story_cluster_items as membership
      join public.news_story_clusters as cluster
        on cluster.id = membership.story_cluster_id
      where membership.news_item_id = item.id
        and membership.membership_status in ('confirmed', 'suggested')
        and cluster.status in ('active', 'closed')
    ) as coverage on true
    where input.normalized is not null
      and (p_status is null or item.status = p_status)
      and (p_source_id is null or item.source_id = p_source_id)
      and (p_item_ids is null or item.id = any(p_item_ids))
      and (p_before is null or item.published_at < p_before)
  ),
  scored as (
    select
      candidate.*,
      (
        case
          when lower(candidate.headline) like '%' || lower(candidate.normalized) || '%'
            then 100.0
          else 0.0
        end +
        case
          when candidate.search_vector @@ candidate.strict_query then 45.0
          else 0.0
        end +
        case
          when candidate.source_vector @@ candidate.strict_query then 20.0
          else 0.0
        end +
        case
          when candidate.coverage_vector @@ candidate.strict_query then 20.0
          else 0.0
        end +
        ts_rank_cd(candidate.search_vector, candidate.broad_query, 32) * 12.0 +
        ts_rank_cd(candidate.source_vector, candidate.broad_query, 32) * 4.0 +
        ts_rank_cd(candidate.coverage_vector, candidate.broad_query, 32) * 6.0
      )::double precision as score,
      array_remove(array[
        case
          when to_tsvector('english', coalesce(candidate.headline, ''))
            @@ candidate.broad_query then 'headline'
        end,
        case
          when to_tsvector('english', coalesce(candidate.summary_text, ''))
            @@ candidate.broad_query then 'summary'
        end,
        case
          when to_tsvector(
            'english',
            coalesce(array_to_string(candidate.categories, ' '), '')
          ) @@ candidate.broad_query then 'categories'
        end,
        case
          when to_tsvector(
            'english',
            coalesce(array_to_string(candidate.authors, ' '), '')
          ) @@ candidate.broad_query then 'authors'
        end,
        case when candidate.source_vector @@ candidate.broad_query then 'source' end,
        case
          when candidate.coverage_vector @@ candidate.broad_query then 'coverage'
        end
      ], null) as fields
    from candidates as candidate
    where candidate.search_vector @@ candidate.broad_query
       or candidate.source_vector @@ candidate.broad_query
       or candidate.coverage_vector @@ candidate.broad_query
  ),
  ranked as (
    select scored.*, count(*) over () as full_count
    from scored
  )
  select
    ranked.id,
    ranked.source_id,
    ranked.headline,
    ranked.canonical_url,
    ranked.authors,
    ranked.categories,
    ranked.published_at,
    ranked.summary_text,
    ranked.content_type,
    ranked.primary_media_type,
    ranked.primary_media_url,
    ranked.thumbnail_url,
    ranked.status,
    ranked.is_pinned,
    ranked.article_access_override,
    ranked.created_at,
    ranked.updated_at,
    ranked.score as match_score,
    ranked.fields as matched_fields,
    ranked.full_count as total_count
  from ranked
  order by ranked.score desc, ranked.published_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_news_items_admin(
  text, text, uuid, uuid[], timestamptz, integer, integer
) from public, anon, authenticated;

grant execute on function public.search_news_items_admin(
  text, text, uuid, uuid[], timestamptz, integer, integer
) to service_role;
