const { BROKER_URL, SEALED } = window.PANELLAB_CONFIG || {};
const status = document.getElementById("status");
const statusText = document.getElementById("statusText");
const retryButton = document.getElementById("retry");
const conn = document.getElementById("conn");
let connecting = false;
let webChatStore = null;
let activitySub = null;
let connSub = null;
const seenActivities = new Set();

function setConn(text, kind) {
  conn.textContent = text;
  conn.className = "conn " + (kind || "");
}
function showStatus(message, kind, retry) {
  status.hidden = false;
  status.className = kind || "";
  statusText.textContent = message;
  retryButton.hidden = !retry;
  setConn(kind === "error" ? "연결 오류" : kind === "warn" ? "주의" : "연결 중", kind);
}
function showError(message) { showStatus(message, "error", true); }

// ConnectionStatus: 0 Uninitialized, 1 Connecting, 2 Online, 3 ExpiredToken, 4 FailedToConnect, 5 Ended
function watchConnection(directLine) {
  if (connSub) connSub.unsubscribe();
  connSub = directLine.connectionStatus$.subscribe({
    next: (s) => {
      if (s === 1) showStatus("채팅에 연결하는 중입니다...");
      else if (s === 2) { status.hidden = true; setConn("연결됨", "online"); }
      else if (s === 3) showStatus("연결 토큰이 만료되었습니다. 다시 시도해 주세요.", "error", true);
      else if (s === 4) showStatus("채팅 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.", "error", true);
      else if (s === 5) showStatus("대화가 종료되었습니다.", "warn", true);
    }
  });
}

// Mirrors the agent's actual bot messages into the result panel without interpreting them.
function watchActivities(directLine) {
  if (activitySub) activitySub.unsubscribe();
  activitySub = directLine.activity$.subscribe({
    next: (a) => {
      if (!a || a.type !== "message" || !a.from || a.from.role !== "bot" || !a.text) return;
      const key = a.id || a.text;
      if (seenActivities.has(key)) return;
      seenActivities.add(key);
      addResultMessage(a);
    }
  });
}

function addResultMessage(activity) {
  document.getElementById("allEmpty").hidden = true;
  const box = document.createElement("div");
  box.className = "msg";
  const t = document.createElement("time");
  const when = activity.timestamp ? new Date(activity.timestamp) : new Date();
  t.textContent = isNaN(when) ? "" : when.toLocaleTimeString("ko-KR");
  box.appendChild(t);
  String(activity.text).split(/```/).forEach((part, i) => {
    if (i % 2 === 1) {
      const code = part.replace(/^[^\n]*\n/, "");
      const wrap = document.createElement("div"); wrap.className = "code-wrap";
      const pre = document.createElement("pre"); pre.textContent = code.replace(/\n$/, "");
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "copy"; btn.textContent = "복사";
      btn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(pre.textContent); btn.textContent = "복사됨"; }
        catch { btn.textContent = "복사 실패"; }
        setTimeout(() => { btn.textContent = "복사"; }, 1500);
      });
      wrap.append(pre, btn);
      box.appendChild(wrap);
    } else if (part.trim()) {
      const p = document.createElement("p"); p.textContent = part.trim();
      box.appendChild(p);
    }
  });
  const list = document.getElementById("allList");
  const panels = document.querySelector(".panels");
  const nearBottom = panels.scrollHeight - panels.scrollTop - panels.clientHeight < 80;
  list.appendChild(box);
  if (nearBottom) panels.scrollTop = panels.scrollHeight;
}

async function connect() {
  if (connecting) return;
  connecting = true;
  try {
    await start();
  } finally {
    connecting = false;
  }
}

async function start() {
  showStatus("채팅에 연결하는 중입니다...");
  if (!BROKER_URL || !SEALED) {
    showError("설정(config.js)을 찾을 수 없습니다. config.example.js를 참고해 주세요.");
    return;
  }
  if (!window.WebChat ||
      typeof WebChat.createDirectLine !== "function" ||
      typeof WebChat.renderWebChat !== "function") {
    showError("채팅 구성 요소를 불러오지 못했습니다. 네트워크를 확인한 뒤 새로고침해 주세요.");
    return;
  }

  let response;
  try {
    // Keep this a simple CORS request; the broker may not support preflight.
    response = await fetch(BROKER_URL, {
      method: "POST",
      body: JSON.stringify({ sealed: SEALED })
    });
  } catch {
    showError("서버에 연결하지 못했습니다. 네트워크와 배포 주소를 확인해 주세요.");
    return;
  }
  if (!response.ok) {
    showError("서버가 연결 요청을 처리하지 못했습니다 (HTTP " + response.status + ").");
    return;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    showError("서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  if (!data || typeof data.token !== "string" || !data.token.trim()) {
    showError("서버에서 연결 토큰을 받지 못했습니다. 암호와 배포 주소를 확인해 주세요.");
    return;
  }

  try {
    const directLine = WebChat.createDirectLine({ token: data.token });
    watchConnection(directLine);
    watchActivities(directLine);
    directLine.postActivity({
      type: "event", name: "startConversation", from: { id: "user" }
    }).subscribe({
      error: () => showStatus("첫 인사를 요청하지 못했습니다. 채팅창에 메시지를 입력해 주세요.", "warn", false)
    });
    const root = document.getElementById("webchat");
    root.replaceChildren();
    webChatStore = WebChat.createStore();
    WebChat.renderWebChat({
      directLine,
      store: webChatStore,
      locale: "ko-KR",
      styleOptions: {
        rootHeight: "100%",
        rootWidth: "100%",
        hideUploadButton: false,
        sendBoxHeight: 48,
        bubbleMaxWidth: 560,
        accent: "#2563eb"
      }
    }, root);
  } catch {
    showError("채팅을 시작하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
  }
}

retryButton.addEventListener("click", connect);
connect();

// ---- Workspace UI (does not touch the Direct Line connection) ----
const body = document.body;
const titles = {
  home: "통합 작업실", write: "PLC 코드 작성", analyze: "오류 검사", fix: "자동 오류 수정",
  ladder: "래더 작화", drawing: "도면 분석", project: "프로젝트 관리", history: "작업 기록", help: "설정"
};

function setWorkbench(open) {
  document.getElementById("workbench").classList.toggle("collapsed", !open);
  const tb = document.getElementById("toggleWb");
  tb.setAttribute("aria-expanded", String(open));
  tb.textContent = open ? "작업 입력 영역 접기" : "작업 입력 영역 펼치기";
}
function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  document.querySelectorAll(".sidebar button").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  body.classList.remove("menu-open");
  setWorkbench(true);
  document.getElementById("workbench").scrollTop = 0;
  if (name === "history") renderHistory();
  document.title = "PanelLab · " + titles[name];
}
document.querySelectorAll("[data-view]").forEach(el => el.addEventListener("click", () => showView(el.dataset.view)));
document.getElementById("toggleWb").addEventListener("click", () => {
  setWorkbench(document.getElementById("workbench").classList.contains("collapsed"));
});

document.getElementById("menuBtn").addEventListener("click", () => body.classList.toggle("menu-open"));
document.getElementById("backdrop").addEventListener("click", () => body.classList.remove("menu-open"));
document.getElementById("fab").addEventListener("click", () => body.classList.add("result-open"));
document.getElementById("resultClose").addEventListener("click", () => {
  body.classList.remove("result-open");
  body.classList.add("result-collapsed");
});
document.getElementById("resultOpenDesktop").addEventListener("click", () => body.classList.remove("result-collapsed"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") body.classList.remove("menu-open", "result-open");
});

document.querySelectorAll(".tabs [data-tab]").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".tabs [data-tab]").forEach(t => t.setAttribute("aria-selected", String(t === tab)));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + tab.dataset.tab));
}));

// Prefill the chat send box; the user reviews and sends it themselves.
const prompts = {
  write: { src: "writeReq", head: "다음 요구사항에 맞는 PLC 코드를 작성해 주세요.\n" },
  analyze: { src: "analyzeCode", head: "다음 PLC 코드/오류를 분석해 주세요.\n" },
  fix: { src: "fixCode", head: "다음 PLC 코드의 오류를 수정해 주세요.\n" },
  drawing: { src: null, head: "첨부한 도면을 분석해 주세요." }
};
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function addHistory(kind, text) {
  const list = loadJSON("panellab.history", []);
  list.unshift({ kind, text: text.slice(0, 200), at: new Date().toLocaleString("ko-KR") });
  try { localStorage.setItem("panellab.history", JSON.stringify(list.slice(0, 50))); } catch {}
}
document.querySelectorAll("[data-send]").forEach(btn => btn.addEventListener("click", () => {
  const p = prompts[btn.dataset.send];
  const extra = p.src ? document.getElementById(p.src).value.trim() : "";
  if (p.src && !extra) { alert("내용을 입력해 주세요."); return; }
  if (!webChatStore) { alert("채팅이 아직 연결되지 않았습니다. 연결 상태를 확인해 주세요."); return; }
  const text = p.head + extra;
  webChatStore.dispatch({ type: "WEB_CHAT/SET_SEND_BOX", payload: { text } });
  addHistory(titles[btn.dataset.send], text);
  setWorkbench(false);
  const input = document.querySelector("#webchat textarea, #webchat input[type=text]");
  if (input) input.focus();
}));

function renderHistory() {
  const box = document.getElementById("historyList");
  const list = loadJSON("panellab.history", []);
  box.replaceChildren();
  if (!list.length) { box.textContent = "기록이 없습니다."; return; }
  list.forEach(item => {
    const d = document.createElement("div"); d.className = "log-item";
    d.textContent = item.kind;
    const s = document.createElement("small"); s.textContent = item.at + " · " + item.text;
    d.appendChild(s); box.appendChild(d);
  });
}
document.getElementById("clearHistory").addEventListener("click", () => {
  localStorage.removeItem("panellab.history"); renderHistory();
});

const projectInput = document.getElementById("projectInput");
const projectName = document.getElementById("projectName");
function applyProject() {
  const n = localStorage.getItem("panellab.project") || "";
  projectName.textContent = n || "미지정"; projectInput.value = n;
}
document.getElementById("saveProject").addEventListener("click", () => {
  localStorage.setItem("panellab.project", projectInput.value.trim()); applyProject();
});
applyProject();
