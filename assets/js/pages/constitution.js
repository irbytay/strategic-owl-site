/* Behavior migrated from the_constitution.html. */
const SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
  const API_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";
  const RANGE = "the_constitution!A2:G1000";


  const colors = {
    gold: "#D4AF37",
    text: "#FFFFFF",
    bullet: "#7C8A9B",
    heading: "#FFFFF0"
  };

  async function fetchAmendmentData() {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    return json.values || [];
  }

  // Patch: Completely refactor initAmendmentDropdown to:
  // 1. Listen for dropdown selection of a documentpart.
  // 2. Load the corresponding hardcoded full text for that part.
  // 3. Retrieve matching Strategic Insight and Prompt from the Google Sheet.
  // 4. Insert the Strategic Insight below the full text container as a paragraph.
  // 5. Insert the Prompt inside a <textarea> styled as described.
  // 6. Add a new <div> and <textarea> below the full text display.
  async function initAmendmentDropdown() {
    const amendmentSelect = document.getElementById("subject-select");
    const outputDiv = document.getElementById("insight-output");
    // Add the new containers for strategic insight and prompt below the outputDiv
    let insightDiv = document.getElementById("strategic-insight");
    if (!insightDiv) {
      insightDiv = document.createElement("div");
      insightDiv.id = "strategic-insight";
      insightDiv.style.marginTop = "2rem";
      // Insert after outputDiv
      outputDiv.insertAdjacentElement("afterend", insightDiv);
    }
    // Only add prompt textarea if not present (no capture button)
    let promptBox = document.getElementById("capture-box");
    // Style for promptBox to match full text and insight box widths (width: 100%; margin: 0 auto;)
    const promptBoxStyle = `
      background-color: #112240;
      border: 2px solid #D4AF37;
      border-radius: 8px;
      padding: 12px 16px;
      font-family: 'Courier', monospace;
      font-size: 14px;
      color: #D4AF37;
      width: 95%;
      margin: 0 auto;
      box-shadow: 0 0 10px #3B6CED;
      white-space: pre-wrap;
      overflow: hidden;
      resize: none;
      display: none;
    `;
    let instructions = document.getElementById("prompt-instructions");
    if (!promptBox) {
      promptBox = document.createElement("textarea");
      promptBox.readOnly = true;
      promptBox.setAttribute("style", promptBoxStyle);
      promptBox.id = "capture-box";
      // Insert the instructional div just above promptBox
      instructions = document.createElement("div");
      instructions.id = "prompt-instructions";
      instructions.textContent = "Capture the prompt. Paste it. See what you find.";
      instructions.style.color = "#D4AF37";
      instructions.style.fontFamily = "Copperplate, serif";
      instructions.style.fontSize = "15px";
      instructions.style.marginTop = "24px";
      instructions.style.marginBottom = "8px";
      instructions.style.textAlign = "center";
      instructions.style.display = "none"; // Initially hidden
      // Insert instructions and promptBox after insightDiv
      const container = insightDiv.parentElement;
      container.appendChild(instructions);
      container.appendChild(promptBox);
    } else {
      instructions = document.getElementById("prompt-instructions");
    }

    // Fetch all document parts and their strategic insight/prompt from Google Sheets
    const sheetData = await fetchAmendmentData();
    // Columns: [A:documentpart, B:section, C:fulltext, D:insight, E:prompt, ...]
    // Build options for dropdown (unique documentpart)
    const seen = {};
    sheetData.forEach(row => {
      const docpart = row[0];
      if (docpart && !seen[docpart]) {
        const opt = document.createElement("option");
        opt.value = docpart;
        opt.textContent = docpart;
        amendmentSelect.appendChild(opt);
        seen[docpart] = true;
      }
    });
    // Add Declaration of Independence as a special case if not present
    if (!seen["Declaration of Independence"]) {
      const decOpt = document.createElement("option");
      decOpt.value = "Declaration of Independence";
      decOpt.textContent = "Declaration of Independence";
      amendmentSelect.appendChild(decOpt);
    }

    // Listen for changes on dropdown (subject-select)
    amendmentSelect.addEventListener("change", () => {
      const selected = amendmentSelect.value;
      outputDiv.innerHTML = "";
      insightDiv.innerHTML = "";
      promptBox.value = "";
      // Remove any previously added full text textarea if present
      let prevFullTextBox = document.getElementById("fulltext-box");
      if (prevFullTextBox) prevFullTextBox.remove();
      // Hide prompt box and instructions by default
      promptBox.style.display = "none";
      if (instructions) instructions.style.display = "none";
      // Remove any previously inserted prompt capture button
      let prevPromptCaptureBtn = document.getElementById("prompt-capture-btn");
      if (prevPromptCaptureBtn) prevPromptCaptureBtn.remove();
      // Remove any previously inserted founding text capture button
      let prevFoundingCaptureBtn = document.getElementById("founding-text-capture-btn");
      if (prevFoundingCaptureBtn) prevFoundingCaptureBtn.remove();
      if (!selected) return;
      let fullText = "";
      let insight = "";
      let prompt = "";
      // Gather all rows where column A matches the selected founding text (selected)
      const matches = sheetData.filter(row => row[0] === selected);
      if (matches.length > 0) {
        // For Preamble and all others: Join all matching full texts, include section label (Column B) above full text, bold the section label
        fullText = matches
          .map(row => `<strong>${row[1]}</strong>\n${row[2]}`)
          .filter(Boolean)
          .join('\n\n');
        // Use only the first matching non-empty insight (Column D)
        insight = matches.find(row => row[3] && row[3].trim())?.[3] || "";
        // Use only the first matching non-empty prompt (Column E)
        prompt = matches.find(row => row[4] && row[4].trim())?.[4] || "";
      }
      // Show the full text in a <pre> styled as per branding
      if (fullText) {
        // Replace all literal \n\n (not actual newlines) with real newlines for display
        const displayText = fullText.replace(/\\n\\n/g, "\n\n");
        // Insert the h2/title inside the pre box at the top
        const fullTextDisplay = document.createElement("pre");
        fullTextDisplay.id = "founding-text-content";
        // Use innerHTML for displayText, now preserving HTML tags (no escaping)
        fullTextDisplay.innerHTML =
          `<div style="text-align: center; font-family: 'Times New Roman', Times, serif; font-style: italic; font-size: 24px; font-weight: 600; margin-bottom: 1rem; color: #5A3E1B;">${selected}</div>` +
          displayText;
        fullTextDisplay.className = "content-box wide-box";
        outputDiv.appendChild(fullTextDisplay);
        // (Founding text capture button removed)
      }
      // Show Strategic Insight below full text
      insightDiv.innerHTML = "";
      if (insight && insight.trim()) {
        const insightText = document.createElement("p");
        // Replace all literal \n\n (not actual newlines) with real newlines for display
        insightText.textContent = insight.replace(/\\n\\n/g, "\n\n");
        insightText.className = "content-box narrow-box";
        insightText.style.fontFamily = '"Roboto", sans-serif';
        insightText.style.borderLeft = `4px solid var(--understanding)`;
        insightText.style.backgroundColor = "#1A2B4C";
        insightText.style.color = "var(--understanding)";
        insightText.style.fontWeight = "500";
        insightDiv.appendChild(insightText);
      }
      // Show Prompt in promptBox (textarea)
      promptBox.value = "";
      promptBox.className = "content-box";
      if (prompt && prompt.trim()) {
        // Replace all literal \n\n (not actual newlines) with real newlines for display
        promptBox.value = prompt.replace(/\\n\\n/g, "\n\n");
      }
      setTimeout(() => {
        promptBox.style.height = "auto";
        promptBox.style.height = promptBox.scrollHeight + "px";
      }, 0);
      // Show prompt box and instructions only if there is a prompt
      if (promptBox.value.trim()) {
        promptBox.style.display = "block";
        if (instructions) instructions.style.display = "block";
        // Add capture button for prompt
        const promptCaptureBtn = document.createElement("button");
        promptCaptureBtn.id = "prompt-capture-btn";
        promptCaptureBtn.textContent = "Capture";
        // Style the button to match prompt visually and structurally
        promptCaptureBtn.style.backgroundColor = "#C4A000";
        promptCaptureBtn.style.border = "1px solid #C4A000";
        promptCaptureBtn.style.color = "#0D1B2A";
        promptCaptureBtn.style.fontFamily = "Copperplate, serif";
        promptCaptureBtn.style.fontWeight = "bold";
        promptCaptureBtn.style.fontSize = "16px";
        promptCaptureBtn.style.borderRadius = "12px";
        promptCaptureBtn.style.padding = "10px 28px";
        promptCaptureBtn.style.boxShadow = "0 6px 20px #3B6CED66";
        promptCaptureBtn.style.cursor = "pointer";
        promptCaptureBtn.style.letterSpacing = "1.2px";
        // Ensure width and centering match promptBox
        promptCaptureBtn.style.margin = "12px auto 8px auto";
        promptCaptureBtn.style.display = "block";
        promptCaptureBtn.style.textAlign = "center";
        // Insert the button immediately after the promptBox
        promptBox.insertAdjacentElement("afterend", promptCaptureBtn);
        promptCaptureBtn.addEventListener("click", () => {
          const text = promptBox.value || promptBox.textContent;
          if (text.trim()) {
            navigator.clipboard.writeText(text.trim()).then(() => {
              promptCaptureBtn.textContent = "Captured";
              setTimeout(() => {
                promptCaptureBtn.textContent = "Capture";
              }, 5000);
            });
          }
        });
      }
    });
  }
  // --- Hardcoded map: right -> founding text value (amendment) ---
  // --- Hardcoded map: amendment -> rights array ---
  const amendmentToRightsMap = {
    "1st Amendment": ["Speak Freely", "Free Press", "Choose Faith", "Gather Peacefully", "Challenge Power"],
    "2nd Amendment": ["Own Arms"],
    "3rd Amendment": ["No Forced Lodging"],
    "4th Amendment": ["Privacy at Home", "Warrants Only"],
    "5th Amendment": ["Fair Process (Federal)", "Stay Silent", "One Trial Only", "Pay for What You Take", "Grand Jury First"],
    "6th Amendment": ["Fast Trial", "Public Trial", "Unbiased Jury", "Know the Charge", "Face Accusers", "Call Witnesses", "Right to Lawyer"],
    "7th Amendment": ["Jury for Civil"],
    "8th Amendment": ["No Excessive Bail", "No Cruel Punishment"],
    "9th Amendment": ["More Rights Exist"],
    "10th Amendment": ["States Hold Power"],
    "11th Amendment": ["Can’t Sue States Easily"],
    "12th Amendment": ["Clear Elections"],
    "13th Amendment": ["Slavery Ends"],
    "14th Amendment": ["Born = Citizen", "Fair Process (States)", "States Must Be Fair", "Rights Apply Nationwide"],
    "15th Amendment": ["Vote Regardless of Race"],
    "16th Amendment": ["Income Tax Legal"],
    "17th Amendment": ["Senators by Vote"],
    "18th Amendment": ["No Alcohol"],
    "19th Amendment": ["Women Can Vote"],
    "20th Amendment": ["Inauguration Reset"],
    "21st Amendment": ["Alcohol Repealed"],
    "22nd Amendment": ["2-Term Max"],
    "23rd Amendment": ["D.C. Votes Too"],
    "24th Amendment": ["No Poll Taxes"],
    "25th Amendment": ["Succession Plan"],
    "26th Amendment": ["Vote at 18"],
    "27th Amendment": ["No Instant Raises"]
  };
  const rightToAmendmentMap = {
    "Speak Freely": { shorthand: "1 (I)", full: "1st Amendment" },
    "Free Press": { shorthand: "1 (I)", full: "1st Amendment" },
    "Choose Faith": { shorthand: "1 (I)", full: "1st Amendment" },
    "Gather Peacefully": { shorthand: "1 (I)", full: "1st Amendment" },
    "Challenge Power": { shorthand: "1 (I)", full: "1st Amendment" },
    "Own Arms": { shorthand: "2 (II)", full: "2nd Amendment" },
    "No Forced Lodging": { shorthand: "3 (III)", full: "3rd Amendment" },
    "Privacy at Home": { shorthand: "4 (IV)", full: "4th Amendment" },
    "Warrants Only": { shorthand: "4 (IV)", full: "4th Amendment" },
    "Fair Process (Federal)": { shorthand: "5 (V)", full: "5th Amendment" },
    "Stay Silent": { shorthand: "5 (V)", full: "5th Amendment" },
    "One Trial Only": { shorthand: "5 (V)", full: "5th Amendment" },
    "Pay for What You Take": { shorthand: "5 (V)", full: "5th Amendment" },
    "Grand Jury First": { shorthand: "5 (V)", full: "5th Amendment" },
    "Fast Trial": { shorthand: "6 (VI)", full: "6th Amendment" },
    "Public Trial": { shorthand: "6 (VI)", full: "6th Amendment" },
    "Unbiased Jury": { shorthand: "6 (VI)", full: "6th Amendment" },
    "Know the Charge": { shorthand: "6 (VI)", full: "6th Amendment" },
    "Face Accusers": { shorthand: "6 (VI)", full: "6th Amendment" },
    "Call Witnesses": { shorthand: "6 (VI)", full: "6th Amendment" },
    "Right to Lawyer": { shorthand: "6 (VI)", full: "6th Amendment" },
    "Jury for Civil": { shorthand: "7 (VII)", full: "7th Amendment" },
    "No Excessive Bail": { shorthand: "8 (VIII)", full: "8th Amendment" },
    "No Cruel Punishment": { shorthand: "8 (VIII)", full: "8th Amendment" },
    "More Rights Exist": { shorthand: "9 (IX)", full: "9th Amendment" },
    "States Hold Power": { shorthand: "10 (X)", full: "10th Amendment" },
    "Can’t Sue States Easily": { shorthand: "11 (XI)", full: "11th Amendment" },
    "Clear Elections": { shorthand: "12 (XII)", full: "12th Amendment" },
    "Slavery Ends": { shorthand: "13 (XIII)", full: "13th Amendment" },
    "Born = Citizen": { shorthand: "14 (XIV)", full: "14th Amendment" },
    "Fair Process (States)": { shorthand: "14 (XIV)", full: "14th Amendment" },
    "States Must Be Fair": { shorthand: "14 (XIV)", full: "14th Amendment" },
    "Rights Apply Nationwide": { shorthand: "14 (XIV)", full: "14th Amendment" },
    "Vote Regardless of Race": { shorthand: "15 (XV)", full: "15th Amendment" },
    "Income Tax Legal": { shorthand: "16 (XVI)", full: "16th Amendment" },
    "Senators by Vote": { shorthand: "17 (XVII)", full: "17th Amendment" },
    "No Alcohol": { shorthand: "18 (XVIII)", full: "18th Amendment" },
    "Women Can Vote": { shorthand: "19 (XIX)", full: "19th Amendment" },
    "Inauguration Reset": { shorthand: "20 (XX)", full: "20th Amendment" },
    "Alcohol Repealed": { shorthand: "21 (XXI)", full: "21st Amendment" },
    "2-Term Max": { shorthand: "22 (XXII)", full: "22nd Amendment" },
    "D.C. Votes Too": { shorthand: "23 (XXIII)", full: "23rd Amendment" },
    "No Poll Taxes": { shorthand: "24 (XXIV)", full: "24th Amendment" },
    "Succession Plan": { shorthand: "25 (XXV)", full: "25th Amendment" },
    "Vote at 18": { shorthand: "26 (XXVI)", full: "26th Amendment" },
    "No Instant Raises": { shorthand: "27 (XXVII)", full: "27th Amendment" }
  };

  const SUBJECT_LOOKUP_RANGE = "the_constitution!F2:G100";

async function fetchSubjectMap() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SUBJECT_LOOKUP_RANGE}?key=${API_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  return json.values || [];
}

// --- Founding Text/Amendment dropdown logic unchanged above ---

// --- Rights dropdown logic with auto-select for founding text ---
function initRightsDropdown() {
  const rightsDropdown = document.getElementById("subject-quick");
  const output = document.getElementById("subject-quick-output");
  // Don't re-initialize if already has options
  if (rightsDropdown.options.length > 1) return;
  // Use the hardcoded map keys for rights
  Object.keys(rightToAmendmentMap).forEach(right => {
    const opt = document.createElement("option");
    opt.value = right;
    opt.textContent = right;
    rightsDropdown.appendChild(opt);
  });

  rightsDropdown.addEventListener("change", () => {
    const selectedRight = rightsDropdown.value;
    const amendmentObj = rightToAmendmentMap[selectedRight];
    // 👉 This is the Rights font — shown when a user selects a right from the first dropdown
    output.innerHTML = amendmentObj
      ? `<div class="founding-text-box" style="font-family: 'Times New Roman', Times, serif; font-style: italic; font-size: 1.2rem; font-weight: 600; color: #5A3E1B;">→ Amendment: ${amendmentObj.shorthand}</div>`
      : "";

    // Always update the founding text dropdown to match the right's amendment
    const matchingAmendment = amendmentObj?.full;
    const foundingTextDropdown = document.getElementById("subject-select");
    if (matchingAmendment) {
      for (let i = 0; i < foundingTextDropdown.options.length; i++) {
        if (foundingTextDropdown.options[i].textContent.trim() === matchingAmendment) {
          foundingTextDropdown.selectedIndex = i;
          foundingTextDropdown.dispatchEvent(new Event("change"));
          break;
        }
      }
    }
  });
}

  window.addEventListener("DOMContentLoaded", () => {
    initAmendmentDropdown();
    initRightsDropdown();
    // No longer auto-select rights dropdown when founding text is changed.
    // Remove logic that updates rights dropdown based on founding text selection.
  });

  // Close mobile menu when clicking outside of it
  document.addEventListener("click", function(event) {
    const navMenu = document.getElementById("navMenu");
    const menuToggle = document.querySelector(".menu-toggle");
    const isClickInsideMenu = navMenu.contains(event.target);
    const isClickOnToggle = menuToggle.contains(event.target);

    if (!isClickInsideMenu && !isClickOnToggle && navMenu.classList.contains("show")) {
      navMenu.classList.remove("show");
    }
  });

  // Remove event listener that sets dataset.userSelected on founding text dropdown

  function toggleMenu() {
    document.getElementById("navMenu").classList.toggle("show");
  }
  // Remove any insightSection flex logic if present (none here, but placeholder for future)
