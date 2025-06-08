const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
const API_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";

const QUIZ_RANGE = "TRUTest!C3:S100";
const INSIGHT_RANGE = "Insights!A2:A12";

let quizData = [];
let insightMessages = [];
let currentIndex = 0;
let userScores = [];

async function fetchTRUData() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${QUIZ_RANGE}?key=${API_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  return json.values;
}

async function fetchInsightMessages() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${INSIGHT_RANGE}?key=${API_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  return json.values.flat();
}

function loadQuestion(index) {
  const [
    question,
    highNarrative,
    moderateNarrative,
    lowNarrative,
    weight,
    ...rest
  ] = quizData[index];

  const scoreRow = rest.slice(0, 11);
  const flipLogic = rest[11]?.toLowerCase() === "false";

  const container = document.getElementById("quiz-question");
  const scale = document.getElementById("quiz-scale");
  const narrativeBox = document.getElementById("narrative-display");
  const nextBtn = document.getElementById("next-question");

  container.innerHTML = `<h2 style="text-align: center; color: var(--understanding); font-family: 'Playfair Display', serif;">${question}</h2>`;
  scale.innerHTML = "";
  narrativeBox.innerHTML = "";
  narrativeBox.style.display = "none";
  nextBtn.style.display = "none";

  const labelRow = document.createElement("div");
labelRow.style.display = "flex";
labelRow.style.justifyContent = "space-between";
labelRow.style.width = "100%";
labelRow.style.maxWidth = "500px";
labelRow.style.margin = "0 auto 10px auto";
labelRow.innerHTML = `
  <span style="font-size: 0.9rem; color: var(--text-muted);">
     <span style="color: gold; font-weight: 600;">0</span> <– Fully Disagree
  </span>
  <span style="font-size: 0.9rem; color: var(--text-muted);">
    Fully Agree –> <span style="color: gold; font-weight: 600;">10</span> 
  </span>
`;
scale.appendChild(labelRow);

  const scaleWrapper = document.createElement("div");
  scaleWrapper.style.display = "flex";
  scaleWrapper.style.justifyContent = "center";
  scaleWrapper.style.gap = "8px";
  scaleWrapper.style.flexWrap = "wrap";

  let selectedBtn = null;

  for (let i = 0; i <= 10; i++) {
    const btn = document.createElement("button");
    btn.textContent = i;
    btn.className = "owl-button";
    btn.style.border = "1px solid var(--understanding)";
    btn.style.backgroundColor = "transparent";
    btn.style.color = "var(--understanding)";
    btn.style.borderRadius = "8px";
    btn.style.padding = "10px 16px";
    btn.style.fontWeight = "bold";
    btn.style.cursor = "pointer";
    btn.style.transition = "all 0.2s ease";

    btn.onclick = () => {
      if (selectedBtn) selectedBtn.style.backgroundColor = "transparent";
      btn.style.backgroundColor = "var(--understanding)";
      btn.style.color = "var(--navy)";
      selectedBtn = btn;

      const adjustedScore = flipLogic ? i : 10 - i;

      let narrative = moderateNarrative;
      if (adjustedScore <= 3) narrative = lowNarrative;
      else if (adjustedScore >= 8) narrative = highNarrative;

      userScores[currentIndex] = {
        score: adjustedScore,
        weight: parseFloat(weight),
        originalInput: i,
        question: question
      };

      narrativeBox.innerHTML = `<p style="margin-top: 20px; font-family: 'Inter', sans-serif; font-size: 1rem; color: var(--text);">${narrative}</p>`;
      narrativeBox.style.display = "block";

      setTimeout(() => {
        nextBtn.style.display = "block";
        nextBtn.textContent = (currentIndex === quizData.length - 1) ? "Show Results" : "Next Question →";
      }, 1500);

      nextBtn.onclick = () => {
        narrativeBox.style.display = "none";
        nextBtn.style.display = "none";
        currentIndex++;
        if (currentIndex < quizData.length) {
          loadQuestion(currentIndex);
        } else {
          showFinalResult();
        }
      };
    };

    scaleWrapper.appendChild(btn);
  }

  scale.appendChild(scaleWrapper);
}

function showFinalResult() {
  let total = 0, weightTotal = 0;
  userScores.forEach(entry => {
    total += entry.score * entry.weight;
    weightTotal += entry.weight;
  });

  const avg = total / weightTotal;
  let label = "⚠️ Domestic Threat";
  if (avg >= 1.0) label = "🕳️ Accelerationist";
  if (avg >= 1.8) label = "🔥 Militant Mindset";
  if (avg >= 2.5) label = "🛰️ Operational Extremist";
  if (avg >= 3.2) label = "🧨 Extremist-Leaning";
  if (avg >= 3.9) label = "📡 Radicalized";
  if (avg >= 4.8) label = "🛡️ Dogmatic";
  if (avg >= 5.7) label = "🪞 Ideological Echo";
  if (avg >= 6.6) label = "🧭 Tilted";
  if (avg >= 7.5) label = "🪶 Healthy Skeptic";
  if (avg >= 8.8) label = "🦉 Grounded";

  const insightIndex = Math.floor(avg);
  const strategicInsight = insightMessages[insightIndex] || "";

  const insightBox = `
  <div style="
    background-color: #101020;
    border: 2px solid #C89B3C;
    color: #F5F5F5;
    font-family: 'Playfair Display', serif;
    font-size: 1.1rem;
    padding: 24px 28px;
    border-radius: 12px;
    margin-bottom: 32px;
    text-align: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  ">
    <div style="
      text-transform: uppercase;
      letter-spacing: 1px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #FFD700;
      margin-bottom: 12px;
    ">
      Strategic Insight
    </div>
    <div style="font-family: 'Inter', sans-serif; font-size: 1rem; line-height: 1.6;">
      ${strategicInsight}
    </div>
  </div>`;

  const resultList = userScores.map(entry => {
    return `
      <div style="
        background-color: var(--surface);
        padding: 16px 20px;
        margin-bottom: 12px;
        border-left: 4px solid var(--reliability);
        border-radius: 6px;
        font-family: 'Inter', sans-serif;
        color: var(--text);
        box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      ">
        <div style="font-weight: 600; margin-bottom: 6px;">${entry.question}</div>
        <div style="font-size: 0.95rem;"><strong>Your Answer:</strong> ${entry.originalInput}</div>
      </div>`;
  }).join("");

  document.getElementById("quiz-container").innerHTML = `
    <h2>Your Strategic Owl Insight</h2>
    <p style="font-size: 1.2rem;">Weighted Score: <strong>${avg.toFixed(2)}</strong></p>
    <p style="font-size: 1.4rem; font-weight: bold; color: var(--understanding);">${label}</p>
    ${insightBox}
    <hr style="margin: 30px 0; border: 1px solid var(--highlight);" />
    <div style="max-width: 700px; margin: 0 auto;">${resultList}</div>
  `;
}

window.addEventListener("DOMContentLoaded", async () => {
  [quizData, insightMessages] = await Promise.all([
    fetchTRUData(),
    fetchInsightMessages()
  ]);
  loadQuestion(currentIndex);
});
