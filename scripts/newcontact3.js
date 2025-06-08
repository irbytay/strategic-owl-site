document.getElementById('score-request-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);

    try {
      const res = await fetch("https://formspree.io/f/mwpodgrw", {
        method: "POST",
        body: formData,
        headers: { 'Accept': 'application/json' }
      });

      const responseText = document.getElementById('form-response');
      if (res.ok) {
        responseText.textContent = "✅ Thanks for your submission! We'll review it shortly.";
        form.reset();
      } else {
        responseText.textContent = "⚠️ There was a problem submitting your request. Try again later.";
      }
    } catch (err) {
      document.getElementById('form-response').textContent = "⚠️ Network error. Please try again.";
    }
  });
