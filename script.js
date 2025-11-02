/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");

// System prompt: assistant should ONLY answer L'Oréal product / routine / recommendation queries
const SYSTEM_PROMPT = `You are an official L'Oréal product assistant. ONLY answer questions related to L'Oréal products, skincare and haircare routines, and product recommendations. If a user asks about non-L'Oréal products or unrelated topics, politely explain you only provide L'Oréal-specific information and offer comparable L'Oréal alternatives when possible. Ask clarifying questions about skin type, hair type, concerns, sensitivities, and budget when needed. Do not provide medical, legal, or diagnostic advice — direct users to a professional in those cases. Keep answers friendly, factual, concise, and include product names and recommended usage steps when relevant.`;

// Chat history stores the conversation (roles: 'user' | 'assistant')
let chatHistory = [];

// Seed with an initial assistant greeting
chatHistory.push({
  role: "assistant",
  content:
    "👋 Hello! I'm the L'Oréal Product Advisor — I can help with L'Oréal products, skincare and haircare routines, and recommendations. What would you like to know?",
  // mark this seeded greeting so we can remove it after the user's first message
  initial: true,
});

// Render the chat history into the chat window
function escapeHtml(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p.innerHTML;
}

function renderChat() {
  chatWindow.innerHTML = "";
  // Determine if we've seen any user messages yet
  const hasUserMessage = chatHistory.some((m) => m.role === "user");
  // Find the first assistant message index so we can selectively hide its meta
  const firstAssistantIndex = chatHistory.findIndex(
    (m) => m.role === "assistant"
  );

  chatHistory.forEach((msg, idx) => {
    const wrapper = document.createElement("div");
    // mark the seeded greeting as an initial special message so we can style it
    wrapper.className = `chat-message ${msg.role}${
      msg.initial ? " initial" : ""
    }`;
    const author = msg.role === "user" ? "You" : "Advisor";

    // Hide the meta for the very first assistant message if no user message has appeared yet.
    const hideMeta =
      msg.role === "assistant" &&
      idx === firstAssistantIndex &&
      !hasUserMessage;

    // Only create and append the meta element when it should be visible.
    // Omitting the element entirely (instead of adding it with display:none)
    // prevents stray layout space from appearing in some browsers/contexts.
    if (!hideMeta) {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      const strong = document.createElement("strong");
      strong.textContent = author;
      meta.appendChild(strong);
      wrapper.appendChild(meta);
    }

    // Append message body
    const body = document.createElement("div");
    body.className = "message-body";
    body.innerHTML = escapeHtml(msg.content);
    wrapper.appendChild(body);

    chatWindow.appendChild(wrapper);
  });
  // keep latest visible
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Call OpenAI Chat Completions API with the system prompt + conversation
async function callOpenAI() {
  // Build messages array for the API: system prompt first, then chat history
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error: ${res.status} ${text}`);
    }

    const data = await res.json();
    const assistantContent =
      data.choices?.[0]?.message?.content ??
      "Sorry, I did not receive a reply.";
    // Append assistant response to history and re-render
    chatHistory.push({ role: "assistant", content: assistantContent });
    renderChat();
  } catch (err) {
    console.error(err);
    chatHistory.push({ role: "assistant", content: `Error: ${err.message}` });
    renderChat();
  } finally {
    userInput.disabled = false;
    sendBtn.disabled = false;
    userInput.focus();
  }
}

// Handle form submit
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  // Remove the seeded initial assistant greeting (if present) so it
  // disappears once the user's message appears in the chat window.
  chatHistory = chatHistory.filter(
    (m) => !(m.role === "assistant" && m.initial === true)
  );

  // Add user message to history and render
  chatHistory.push({ role: "user", content: text });
  renderChat();

  // Clear input and disable while waiting for response
  userInput.value = "";
  userInput.disabled = true;
  sendBtn.disabled = true;

  // Show a brief typing indicator while we wait
  chatHistory.push({ role: "assistant", content: "Thinking..." });
  renderChat();

  // Remove the temporary 'Thinking...' before calling the API
  chatHistory = chatHistory.filter(
    (m) => !(m.role === "assistant" && m.content === "Thinking...")
  );

  // Call the API and handle response
  await callOpenAI();
});

// Initial render
renderChat();

/*
  Security note (display-only): This example uses `secrets.js` in the client for simplicity (the file defines `apiKey`).
  DO NOT ship a real API key in client-side code for production. Instead, proxy requests through a server or Cloudflare Worker.
*/
