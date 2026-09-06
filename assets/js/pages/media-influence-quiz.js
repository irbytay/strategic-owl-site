/* Behavior migrated from strategic-owl-insight-quiz.html. */
const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
const API_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";

const QUIZ_RANGE = "TRUTest!C3:AA12";
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
    ...narratives
  ] = quizData[index];

  const scoreRow = narratives.slice(0, 11); // D to N (10 to 0 scale)
  const weight = parseFloat(narratives[11]); // O
  const userAnswerRow = narratives.slice(12, 23); // P to Z (optional future use)
  const flipLogic = narratives[23]?.toLowerCase() === "false"; // AA

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

      const rawScore = i;
      const adjustedScore = flipLogic ? rawScore : 10 - rawScore;
      const narrativeIndex = 10 - adjustedScore; // align narrative with final score
      const narrative = scoreRow[narrativeIndex];

      userScores[currentIndex] = {
        score: adjustedScore,
        weight: weight,
        originalInput: i,
        question: question,
        narrative: narrative
      };

      narrativeBox.innerHTML = `<p style="margin-top: 20px; font-family: 'Inter', sans-serif; font-size: 1rem; color: var(--text);">${narrative}</p>`;
      narrativeBox.style.display = "block";
      narrativeBox.scrollIntoView({ behavior: 'smooth', block: 'center' });

      setTimeout(() => {
        nextBtn.style.display = "block";
        nextBtn.textContent = (currentIndex === quizData.length - 1) ? "Yes. Show Results" : "Yes. Continue →";
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
  let total = 0;
  const maxPossible = userScores.reduce((sum, entry) => sum + (10 * entry.weight), 0);
  userScores.forEach(entry => {
    total += entry.score * entry.weight;
  });

  const rawScore = total;
  const percentage = (rawScore / maxPossible) * 100;

  let label = "⚠️ Civic Threat";
  if (percentage >= 10.0) label = "🕳️ Ideological Captive";
  if (percentage >= 18.0) label = "🔥 Echoed Extremism";
  if (percentage >= 25.0) label = "🛰️ Detached Operator";
  if (percentage >= 32.0) label = "🧨 Fringe-Aligned";
  if (percentage >= 39.0) label = "📡 Rigid Thinker";
  if (percentage >= 48.0) label = "🛡️ Questioning Dogma";
  if (percentage >= 57.0) label = "🪞 Seeking Balance";
  if (percentage >= 66.0) label = "🧭 Healthy Skeptic";
  if (percentage >= 75.0) label = "🪶 Strategic Thinker";
  if (percentage >= 88.0) label = "🦉 Civically Grounded";

  const insightIndex = Math.floor(rawScore / maxPossible * 10); // adjust if needed
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
        <div style="font-size: 0.95rem;"><strong>Your Answer:</strong> 
          <span style="color: var(--truth); font-weight: 600;">${entry.originalInput}</span> 
          <span style="font-size: 0.85rem; color: var(--text-muted); font-style: italic;">(Weight: ${entry.weight})</span>
        </div>
        <div style="
          font-size: 0.95rem;
          margin-top: 8px;
          line-height: 1.5;
          color: var(--text);
          font-family: 'Inter', sans-serif;
          background-color: rgba(255,255,255,0.03);
          padding: 12px 14px;
          border-left: 3px solid var(--understanding);
          border-radius: 6px;
        ">
          <strong style="color: var(--understanding); font-weight: 600;">What You Agreed To:</strong><br />
          ${entry.narrative}
        </div>
      </div>`;
  }).join("");

  document.getElementById("quiz-container").innerHTML = `
    <h2>Your Strategic Owl Insight</h2>
    <p style="font-size: 1.2rem;">Score: <strong>${rawScore.toFixed(2)} / ${maxPossible}</strong></p>
    <p style="font-size: 1.2rem;">Percentage: <strong>${percentage.toFixed(1)}%</strong></p>
    <p style="font-size: 1.4rem; font-weight: bold; color: var(--understanding);">${label}</p>
    ${insightBox}
    <hr style="margin: 30px 0; border: 1px solid var(--highlight);" />
    <div style="max-width: 700px; margin: 0 auto;">${resultList}</div>
    <div style="text-align: center; margin-top: 32px;">
      <button onclick="location.reload()" style="
        background-color: var(--understanding);
        color: var(--navy);
        padding: 12px 28px;
        border: none;
        border-radius: 10px;
        font-size: 1rem;
        font-family: 'Playfair Display', serif;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.3s ease, box-shadow 0.3s ease;
      " onmouseover="this.style.boxShadow='0 0 10px var(--understanding)';"
        onmouseout="this.style.boxShadow='none';">
        Take Quiz Again
      </button>
    </div>
  `;
}

window.addEventListener("DOMContentLoaded", async () => {
  [quizData, insightMessages] = await Promise.all([
    fetchTRUData(),
    fetchInsightMessages()
  ]);
  loadQuestion(currentIndex);
});

function toggleMenu() {
  document.getElementById("navMenu").classList.toggle("show");
}

function closeMenuOnOutsideClick(event) {
  const navMenu = document.getElementById("navMenu");
  const menuToggle = document.querySelector(".menu-toggle");

  if (
    navMenu.classList.contains("show") &&
    !navMenu.contains(event.target) &&
    !menuToggle.contains(event.target)
  ) {
    navMenu.classList.remove("show");
  }
}

document.addEventListener("click", closeMenuOnOutsideClick);
