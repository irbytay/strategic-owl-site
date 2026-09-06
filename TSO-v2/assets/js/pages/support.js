(function () {
  "use strict";

  const SUPABASE_URL = "https://gopyzkcmvkbusdnwjlbb.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_CYM_aXzslre6SE8P-tTYBw_sw_-gQ1h";
  const OWL_ADMINISTRATOR_ID = "5f96faeb-ec9e-4069-9b91-cbc65e422f73";
  const PROFILE_BUCKET = "app-images";

  async function loadProfileImage() {
    const image = document.getElementById("support-profile-image");
    if (!image) return;

    const url = new URL(`${SUPABASE_URL}/rest/v1/owl_profile`);
    url.searchParams.set("select", "avatar_path");
    url.searchParams.set("id", `eq.${OWL_ADMINISTRATOR_ID}`);
    url.searchParams.set("limit", "1");

    try {
      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
      });

      if (!response.ok) return;
      const rows = await response.json();
      const avatarPath = String(rows?.[0]?.avatar_path || "").trim();
      if (!avatarPath) return;

      const safePath = avatarPath
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
      image.src = `${SUPABASE_URL}/storage/v1/object/public/${PROFILE_BUCKET}/${safePath}`;
    } catch (_) {
      // Keep the bundled profile image when Supabase is unavailable.
    }
  }

  document.getElementById("support-open-owl-access")?.addEventListener("click", () => {
    window.StrategicOwlAccess?.open();
  });

  loadProfileImage();
})();
