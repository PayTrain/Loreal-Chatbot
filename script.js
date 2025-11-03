/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");

// System prompt: assistant should ONLY answer L'Oréal product / routine / recommendation queries
const SYSTEM_PROMPT = `You are an official L'Oréal product assistant. ONLY answer questions related to L'Oréal products, skincare and haircare routines, and product recommendations. If a user asks about non-L'Oréal products or unrelated topics, politely explain you only provide L'Oréal-specific information and offer comparable L'Oréal alternatives when possible. Ask clarifying questions about skin type, hair type, concerns, sensitivities, and budget when needed. Do not provide medical, legal, or diagnostic advice — direct users to a professional in those cases. Keep answers friendly, factual, concise, and include product names and recommended usage steps when relevant.`;

// Cloudflare Worker endpoint (proxy to OpenAI) — client should NOT send the OpenAI API key
const WORKER_URL = "https://loreal-chatbot-worker.pmackmurphy.workers.dev/";

// Chat history stores the conversation (roles: 'user' | 'assistant')
let chatHistory = [];

// Simple user profile to track name and other short facts
let userProfile = { name: null };
// Track whether we've already asked for the user's name this session
let hasAskedName = false;

// Load persisted state if present (keeps context across reloads)
// Clear persisted state on load so the chatbot restarts on refresh
try {
  localStorage.removeItem("chatHistory");
  localStorage.removeItem("userProfile");
} catch (e) {
  console.warn("Could not clear saved chat state", e);
}

// Seed with an initial assistant greeting only when no saved history exists
if (chatHistory.length === 0) {
  chatHistory.push({
    role: "assistant",
    content:
      "👋 Hello! I'm the L'Oréal Product Advisor — I can help with L'Oréal products, skincare and haircare routines, and recommendations. What would you like to know?",
    // mark this seeded greeting so we can remove it after the user's first message
    initial: true,
  });
}

// Persist chat state
function saveState() {
  try {
    localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
    localStorage.setItem("userProfile", JSON.stringify(userProfile));
  } catch (e) {
    console.warn("Could not save chat state", e);
  }
}

// Render the chat history into the chat window
function escapeHtml(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p.innerHTML;
}

// Convert lightweight markdown-style markers into safe HTML.
// Supports: headings (# through ######), bold (**text**), italics (*text* or _text_),
// and bullet lists (lines starting with -, *, or +).
// This function first escapes any HTML in the input (preventing XSS),
// then applies formatting while keeping the interior text already escaped.
function formatMessage(text) {
  if (!text) return "";
  // Escape all HTML first
  let safe = escapeHtml(text);

  // Process line by line to handle headings, lists, and formatting
  const lines = safe.split(/\r?\n/);
  let formatted = "";
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Check for headings (# through ######)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Close any open list
      if (inList) {
        formatted += "</ul>";
        inList = false;
      }
      const level = headingMatch[1].length;
      let headingText = headingMatch[2];
      // Apply bold/italic formatting inside headings
      headingText = applyInlineFormatting(headingText);
      formatted += `<h${level}>${headingText}</h${level}>`;
      continue;
    }

    // Check for bullet lists (-, *, or + followed by space)
    const bulletMatch = line.match(/^\s*([-*+])\s+(.*)$/);
    if (bulletMatch) {
      if (!inList) {
        formatted += "<ul>";
        inList = true;
      }
      let item = bulletMatch[2];
      item = applyInlineFormatting(item);
      formatted += `<li>${item}</li>`;
      continue;
    }

    // Regular line - close list if open
    if (inList) {
      formatted += "</ul>";
      inList = false;
    }

    // Apply inline formatting to regular lines
    line = applyInlineFormatting(line);
    formatted += line;

    // Add line breaks between non-empty lines (but not after last line)
    if (i < lines.length - 1) {
      const nextLine = lines[i + 1];
      // Don't add <br> if next line is a heading or bullet, or current/next is empty
      const nextIsHeading = /^#{1,6}\s+/.test(nextLine);
      const nextIsBullet = /^\s*[-*+]\s+/.test(nextLine);
      const currentIsEmpty = line.trim() === "";
      const nextIsEmpty = nextLine.trim() === "";

      if (!nextIsHeading && !nextIsBullet && !currentIsEmpty && !nextIsEmpty) {
        formatted += "<br>";
      } else if (currentIsEmpty || nextIsEmpty) {
        formatted += "<br>";
      }
    }
  }

  // Close list if still open at end
  if (inList) {
    formatted += "</ul>";
  }

  return formatted;
}

// Helper function to apply inline formatting (bold and italic)
function applyInlineFormatting(text) {
  // Bold: **text**
  text = text.replace(/\*\*(.+?)\*\*/g, (match, p1) => {
    return `<strong>${p1}</strong>`;
  });
  // Italics with single asterisks: *text* (not part of **)
  text = text.replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, (match, p1) => {
    return `<em>${p1}</em>`;
  });
  // Italics with underscores: _text_
  text = text.replace(/(?<!_)_(?!_)([^_]+?)_(?!_)/g, (match, p1) => {
    return `<em>${p1}</em>`;
  });
  return text;
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
    // Format the message: escape any HTML and apply lightweight **bold** markup.
    body.innerHTML = formatMessage(msg.content);
    wrapper.appendChild(body);

    chatWindow.appendChild(wrapper);
  });
  // keep latest visible
  chatWindow.scrollTop = chatWindow.scrollHeight;
  // persist after rendering
  saveState();
}

// Call OpenAI Chat Completions API with the system prompt + conversation
async function callOpenAI() {
  // Build messages array for the API: system prompt first, then user profile (if any), then chat history
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  if (userProfile && userProfile.name) {
    messages.push({
      role: "system",
      content: `User profile: name=${userProfile.name}. Remember this for future responses and personalize when appropriate.`,
    });
  }
  messages.push(
    ...chatHistory.map((m) => ({ role: m.role, content: m.content }))
  );

  try {
    // Send request to the Cloudflare Worker which proxies to OpenAI and keeps the API key server-side.
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Worker proxy error: ${res.status} ${text}`);
    }

    const data = await res.json();
    const assistantContent =
      data.choices?.[0]?.message?.content ??
      "Sorry, I did not receive a reply.";
    // Append assistant response to history and re-render
    chatHistory.push({ role: "assistant", content: assistantContent });
    renderChat();
    saveState();
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

  // allow user to set their name with a shortcut: `/name YourName`
  if (text.toLowerCase().startsWith("/name ")) {
    const name = text.slice(6).trim();
    if (name) {
      userProfile.name = name;
      // acknowledge and persist
      chatHistory.push({
        role: "assistant",
        content: `Nice to meet you, ${userProfile.name}. I'll remember that for this session.`,
      });
      renderChat();
      saveState();
      userInput.value = "";
    }
    return;
  }

  // If we don't yet have a name for the user, ask only once after the first prompt (optional)
  if (!userProfile.name && !hasAskedName) {
    try {
      const namePrompt = prompt(
        "Optional: what's your name? Leave empty to skip."
      );
      if (namePrompt && namePrompt.trim()) {
        userProfile.name = namePrompt.trim();
        chatHistory.push({
          role: "assistant",
          content: `Nice to meet you, ${userProfile.name}. I'll remember that for this session.`,
        });
      }
    } catch (e) {
      // prompt may be blocked; continue without a name
    }
    // Ensure we only ask once per session, even if the user skipped entering a name
    hasAskedName = true;
  }

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
