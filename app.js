
import { createClient } from
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
} from "./config.js";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

let currentUser = null;
let currentProfile = null;
let reactionStarted = 0;
let reactionTimer = null;

const $ = id => document.getElementById(id);

function message(id, text) {
  $(id).textContent = text;
}

function toast(text) {
  $("toast").textContent = text;
  setTimeout(() => $("toast").textContent = "", 3000);
}

function showApp(loggedIn) {
  $("authSection").hidden = loggedIn;
  $("appSection").hidden = !loggedIn;
  $("accountStatus").textContent =
    loggedIn ? "Angemeldet" : "Nicht angemeldet";
}

function showPage(name) {
  document.querySelectorAll(".page").forEach(page => {
    page.hidden = page.id !== `page-${name}`;
  });

  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === name
    );
  });

  if (name === "leaderboard") loadLeaderboard();
  if (name === "admin") loadAdmin();
}

document.querySelectorAll(".nav-button").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

async function refreshProfile() {
  if (!currentUser) return;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();

  if (error) {
    toast("Profil konnte nicht geladen werden.");
    return;
  }

  currentProfile = data;

  $("displayName").textContent = data.username;
  $("playerName").textContent = data.username;
  $("coinBalance").textContent = data.coins.toLocaleString("de-DE");
  $("levelValue").textContent = data.level;
  $("xpValue").textContent = data.xp;
  $("gamesValue").textContent = data.games_played;
  $("newUsername").value = data.username;
  $("adminNav").hidden = data.role !== "admin";
}

async function register() {
  const email = $("email").value.trim();
  const password = $("password").value;
  const username = $("username").value.trim();

  if (!email || !password || username.length < 3) {
    message("authMessage", "Bitte fülle alle Felder korrekt aus.");
    return;
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });

  if (error) {
    message("authMessage", error.message);
    return;
  }

  if (!data.session) {
    message(
      "authMessage",
      "Registrierung erfolgreich! Bitte bestätige deine E-Mail-Adresse."
    );
  } else {
    message("authMessage", "Account erstellt.");
  }
}

async function login() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });

  if (error) {
    message("authMessage", error.message);
    return;
  }

  currentUser = data.user;
  await enterApp();
}

async function enterApp() {
  showApp(true);
  await refreshProfile();
  showPage("home");
}

async function logout() {
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
  showApp(false);
}

async function dailyBonus() {
  const { data, error } = await supabase.rpc("claim_daily_bonus");

  if (error) {
    message("dailyMessage", error.message);
    return;
  }

  message("dailyMessage", `Du hast ${data} Coins erhalten!`);
  await refreshProfile();
}

async function awardGame(game, points) {
  const { data, error } = await supabase.rpc("claim_game_reward", {
    p_game: game,
    p_score: points
  });

  if (error) {
    toast(error.message);
    return;
  }

  toast(`Belohnung: ${data} Coins`);
  await refreshProfile();
}

async function loadLeaderboard() {
  const { data, error } = await supabase
    .from("profiles")
    .select("username, coins, level, xp")
    .order("coins", { ascending: false })
    .limit(20);

  if (error) {
    $("leaderboardList").textContent = "Rangliste nicht verfügbar.";
    return;
  }

  $("leaderboardList").innerHTML = data.map((player, index) => `
    <div class="leader-row">
      <b>#${index + 1} ${escapeHTML(player.username)}</b>
      <span>${player.coins.toLocaleString("de-DE")} Coins · Level ${player.level}</span>
    </div>
  `).join("");
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

async function saveProfile() {
  const username = $("newUsername").value.trim();

  if (username.length < 3 || username.length > 20) {
    message("profileMessage", "Der Name muss 3–20 Zeichen haben.");
    return;
  }

  const { error } = await supabase.rpc("change_username", {
    p_username: username
  });

  if (error) {
    message("profileMessage", error.message);
    return;
  }

  message("profileMessage", "Profil gespeichert.");
  await refreshProfile();
}

async function loadAdmin() {
  if (!currentProfile || currentProfile.role !== "admin") {
    $("adminContent").textContent = "Kein Zugriff.";
    return;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("username, coins, level, role, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    $("adminContent").textContent = "Daten konnten nicht geladen werden.";
    return;
  }

  $("adminContent").innerHTML = data.map(user => `
    <p><b>${escapeHTML(user.username)}</b> —
    ${user.coins} Coins · Level ${user.level} ·
    ${escapeHTML(user.role)}</p>
  `).join("");
}

function gamePanel(title, description) {
  $("gameArea").hidden = false;
  $("gameArea").innerHTML = `
    <h2>${escapeHTML(title)}</h2>
    <p>${escapeHTML(description)}</p>
    <div id="gameControls"></div>
    <p id="gameMessage" class="message"></p>
  `;
}

function button(container, label, callback) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.addEventListener("click", callback);
  container.appendChild(btn);
  return btn;
}

function startGame(name) {
  const area = $("gameArea");
  const controls = () => $("gameControls");

  if (name === "roulette") {
    gamePanel("Roulette-Show", "Drehe das kostenlose Glücksrad. Keine Einsätze.");
    button(controls(), "Rad drehen", async event => {
      event.currentTarget.disabled = true;
      const rewards = [5, 10, 15, 20];
      const reward = rewards[Math.floor(Math.random() * rewards.length)];
      message("gameMessage", `Das Rad zeigt ${reward} Bonus-Coins!`);
      await awardGame("roulette", reward);
      event.currentTarget.disabled = false;
    });
  }

  if (name === "blackjack") {
    gamePanel("Blackjack-Trainer", "Übe das Kartenspiel ohne Einsatz.");
    const cards = [2,3,4,5,6,7,8,9,10,10,10,11];
    let total = 0;
    let draws = 0;
    button(controls(), "Karte ziehen", () => {
      total += cards[Math.floor(Math.random() * cards.length)];
      draws++;
      message("gameMessage", `Deine Punktzahl: ${total}`);
      if (total >= 21 || draws >= 5) {
        message("gameMessage", `Runde beendet. Ergebnis: ${total}.`);
        if (total <= 21) awardGame("blackjack", 10);
      }
    });
    button(controls(), "Neue Runde", () => {
      total = 0;
      draws = 0;
      message("gameMessage", "Neue Runde gestartet.");
    });
  }

  if (name === "slots") {
    gamePanel("Slot-Show", "Finde drei gleiche Symbole. Kostenloses Symbolspiel.");
    button(controls(), "Symbole anzeigen", async event => {
      event.currentTarget.disabled = true;
      const symbols = ["★", "◆", "●", "▲"];
      const result = Array.from({length: 3}, () =>
        symbols[Math.floor(Math.random() * symbols.length)]
      );
      message("gameMessage", result.join("   "));
      const points = result.every(x => x === result[0]) ? 20 : 5;
      await awardGame("slots", points);
      event.currentTarget.disabled = false;
    });
  }

  if (name === "plinko") {
    gamePanel("Plinko", "Lass eine Kugel durch das Spielfeld fallen.");
    button(controls(), "Kugel fallen lassen", async event => {
      event.currentTarget.disabled = true;
      const result = Math.floor(Math.random() * 5);
      message("gameMessage", `Die Kugel landet in Feld ${result + 1}.`);
      await awardGame("plinko", 5 + result * 2);
      event.currentTarget.disabled = false;
    });
  }

  if (name === "mines") {
    gamePanel("Mines-Suche", "Finde das versteckte Ziel im Logik-Puzzle.");
    let target = Math.floor(Math.random() * 9);
    for (let i = 0; i < 9; i++) {
      button(controls(), `Feld ${i + 1}`, async event => {
        if (event.currentTarget.disabled) return;
        if (i === target) {
          message("gameMessage", "Gefunden! Du hast das Ziel entdeckt.");
          await awardGame("mines", 15);
          [...controls().children].forEach(b => b.disabled = true);
        } else {
          event.currentTarget.disabled = true;
          message("gameMessage", "Nicht dieses Feld. Versuche es weiter.");
        }
      });
    }
  }

  if (name === "crash") {
    gamePanel("Rocket Challenge", "Stoppe die Rakete im Reaktionsspiel.");
    button(controls(), "Challenge starten", () => {
      message("gameMessage", "Bereit? Warte auf das Signal …");
      const start = Date.now();
      const delay = 1000 + Math.random() * 2500;
      const btn = controls().firstChild;
      btn.disabled = true;
      setTimeout(() => {
        message("gameMessage", "JETZT! Klicke so schnell du kannst.");
        const signal = Date.now();
        btn.disabled = false;
        btn.textContent = "JETZT KLICKEN";
        btn.onclick = async () => {
          const ms = Date.now() - signal;
          message("gameMessage", `Deine Reaktionszeit: ${ms} ms`);
          if (ms < 700) await awardGame("crash", 15);
          else toast("Guter Versuch! Übe weiter.");
          btn.textContent = "Challenge starten";
          btn.onclick = () => startGame("crash");
        };
      }, delay);
    });
  }
}

function startMini(name) {
  $("miniArea").hidden = false;
  $("miniArea").innerHTML = `<h2>${escapeHTML(name)}</h2><div id="miniControls"></div><p id="miniMessage"></p>`;
  const controls = $("miniControls");

  if (name === "reaction") {
    button(controls, "Start", () => {
      message("miniMessage", "Warte auf das grüne Signal …");
      const startButton = controls.firstChild;
      startButton.disabled = true;
      const delay = 1200 + Math.random() * 2500;
      clearTimeout(reactionTimer);
      reactionTimer = setTimeout(() => {
        reactionStarted = Date.now();
        startButton.textContent = "JETZT!";
        startButton.disabled = false;
        startButton.onclick = async () => {
          const time = Date.now() - reactionStarted;
          message("miniMessage", `${time} ms`);
          if (time < 1000) await awardGame("reaction", 20);
          else message("miniMessage", "Versuche es noch einmal!");
          startButton.textContent = "Start";
          startButton.onclick = () => startMini("reaction");
        };
      }, delay);
    });
  }

  if (name === "quiz") {
    const questions = [
      {q:"Wie viele Tage hat eine Woche?", a:["5","7","10"], correct:1},
      {q:"Welche Farbe entsteht aus Blau und Gelb?", a:["Grün","Rot","Lila"], correct:0},
      {q:"Wie viel ist 9 × 8?", a:["64","72","81"], correct:1}
    ];
    let index = 0;
    let score = 0;
    function ask() {
      if (index >= questions.length) {
        message("miniMessage", `Du hast ${score} von 3 richtig.`);
        if (score > 0) awardGame("quiz", score * 5);
        return;
      }
      const q = questions[index];
      controls.innerHTML = `<p>${q.q}</p>`;
      q.a.forEach((answer, i) => button(controls, answer, () => {
        if (i === q.correct) score++;
        index++;
        ask();
      }));
    }
    ask();
  }

  if (name === "memory") {
    const values = ["★","◆","●","▲","★","◆","●","▲"];
    values.sort(() => Math.random() - 0.5);
    let first = null;
    let matched = 0;
    const buttons = [];
    values.forEach((value, i) => {
      const btn = button(controls, "?", () => {
        if (btn.disabled || btn.textContent !== "?") return;
        btn.textContent = value;
        if (first === null) {
          first = {btn, value};
        } else {
          const previous = first;
          first = null;
          if (previous.value === value) {
            previous.btn.disabled = true;
            btn.disabled = true;
            matched += 2;
            if (matched === values.length) {
              message("miniMessage", "Alle Paare gefunden!");
              awardGame("memory", 20);
            }
          } else {
            setTimeout(() => {
              previous.btn.textContent = "?";
              btn.textContent = "?";
            }, 700);
          }
        }
      });
      buttons.push(btn);
    });
  }
}

$("registerBtn").addEventListener("click", register);
$("loginBtn").addEventListener("click", login);
$("dailyBtn").addEventListener("click", dailyBonus);
$("logoutBtn").addEventListener("click", logout);
$("saveProfileBtn").addEventListener("click", saveProfile);

document.querySelectorAll("[data-game]").forEach(btn => {
  btn.addEventListener("click", () => {
    startGame(btn.dataset.game);
    $("gameArea").scrollIntoView({behavior:"smooth"});
  });
});

document.querySelectorAll("[data-mini]").forEach(btn => {
  btn.addEventListener("click", () => {
    startMini(btn.dataset.mini);
    $("miniArea").scrollIntoView({behavior:"smooth"});
  });
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user ?? null;
  if (currentUser) await enterApp();
  else showApp(false);
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) {
  currentUser = session.user;
  await enterApp();
} else {
  showApp(false);
}
