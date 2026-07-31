const season = 2026;

const teamColors = {
  Mercedes: "#00a19c",
  Ferrari: "#e8002d",
  McLaren: "#ff8000",
  "Red Bull Racing": "#3671c6",
  "Racing Bulls": "#6692ff",
  Alpine: "#ff87bc",
  "Haas F1 Team": "#b6babd",
  Haas: "#b6babd",
  Audi: "#d8ff00",
  Williams: "#64c4ff",
  "Aston Martin": "#229971",
  Cadillac: "#d0d0d0",
};

const fallbackDrivers = [
  { position: 1, number: "12", code: "ANT", name: "Andrea Kimi Antonelli", flag: "🇮🇹", team: "Mercedes", points: 219 },
  { position: 2, number: "44", code: "HAM", name: "Lewis Hamilton", flag: "🇬🇧", team: "Ferrari", points: 169 },
  { position: 3, number: "63", code: "RUS", name: "George Russell", flag: "🇬🇧", team: "Mercedes", points: 160 },
  { position: 4, number: "16", code: "LEC", name: "Charles Leclerc", flag: "🇲🇨", team: "Ferrari", points: 138 },
  { position: 5, number: "1", code: "NOR", name: "Lando Norris", flag: "🇬🇧", team: "McLaren", points: 128 },
  { position: 6, number: "3", code: "VER", name: "Max Verstappen", flag: "🇳🇱", team: "Red Bull Racing", points: 109 },
  { position: 7, number: "81", code: "PIA", name: "Oscar Piastri", flag: "🇦🇺", team: "McLaren", points: 92 },
  { position: 8, number: "6", code: "HAD", name: "Isack Hadjar", flag: "🇫🇷", team: "Red Bull Racing", points: 68 },
  { position: 9, number: "30", code: "LAW", name: "Liam Lawson", flag: "🇳🇿", team: "Racing Bulls", points: 43 },
  { position: 10, number: "10", code: "GAS", name: "Pierre Gasly", flag: "🇫🇷", team: "Alpine", points: 42 },
  { position: 11, number: "41", code: "LIN", name: "Arvid Lindblad", flag: "🇬🇧", team: "Racing Bulls", points: 23 },
  { position: 12, number: "43", code: "COL", name: "Franco Colapinto", flag: "🇦🇷", team: "Alpine", points: 19 },
  { position: 13, number: "87", code: "BEA", name: "Oliver Bearman", flag: "🇬🇧", team: "Haas F1 Team", points: 18 },
  { position: 14, number: "5", code: "BOR", name: "Gabriel Bortoleto", flag: "🇧🇷", team: "Audi", points: 10 },
  { position: 15, number: "55", code: "SAI", name: "Carlos Sainz", flag: "🇪🇸", team: "Williams", points: 6 },
  { position: 16, number: "23", code: "ALB", name: "Alexander Albon", flag: "🇹🇭", team: "Williams", points: 5 },
  { position: 17, number: "31", code: "OCO", name: "Esteban Ocon", flag: "🇫🇷", team: "Haas F1 Team", points: 3 },
  { position: 18, number: "27", code: "HUL", name: "Nico Hulkenberg", flag: "🇩🇪", team: "Audi", points: 2 },
  { position: 19, number: "14", code: "ALO", name: "Fernando Alonso", flag: "🇪🇸", team: "Aston Martin", points: 1 },
  { position: 20, number: "18", code: "STR", name: "Lance Stroll", flag: "🇨🇦", team: "Aston Martin", points: 0 },
  { position: 21, number: "77", code: "BOT", name: "Valtteri Bottas", flag: "🇫🇮", team: "Cadillac", points: 0 },
  { position: 22, number: "11", code: "PER", name: "Sergio Perez", flag: "🇲🇽", team: "Cadillac", points: 0 },
];

const fallbackConstructors = [
  { position: 1, name: "Mercedes", points: 379 },
  { position: 2, name: "Ferrari", points: 307 },
  { position: 3, name: "McLaren", points: 220 },
  { position: 4, name: "Red Bull Racing", points: 177 },
  { position: 5, name: "Racing Bulls", points: 66 },
  { position: 6, name: "Alpine", points: 61 },
  { position: 7, name: "Haas F1 Team", points: 21 },
  { position: 8, name: "Audi", points: 12 },
  { position: 9, name: "Williams", points: 11 },
  { position: 10, name: "Aston Martin", points: 1 },
  { position: 11, name: "Cadillac", points: 0 },
];

const races = [
  { round: 1, slug: "australia", flag: "🇦🇺", country: "澳大利亚", name: "澳大利亚大奖赛", circuit: "Albert Park Circuit", dates: "03.06 — 03.08", raceTime: "2026-03-08T04:00:00Z", laps: 58, length: "5.278", winner: "George Russell · RUS" },
  { round: 2, slug: "china", flag: "🇨🇳", country: "中国", name: "中国大奖赛", circuit: "Shanghai International Circuit", dates: "03.13 — 03.15", raceTime: "2026-03-15T07:00:00Z", laps: 56, length: "5.451", winner: "Kimi Antonelli · ANT" },
  { round: 3, slug: "japan", flag: "🇯🇵", country: "日本", name: "日本大奖赛", circuit: "Suzuka Circuit", dates: "03.27 — 03.29", raceTime: "2026-03-29T05:00:00Z", laps: 53, length: "5.807", winner: "Kimi Antonelli · ANT" },
  { round: 4, slug: "miami", flag: "🇺🇸", country: "美国 · 迈阿密", name: "迈阿密大奖赛", circuit: "Miami International Autodrome", dates: "05.01 — 05.03", raceTime: "2026-05-03T20:00:00Z", laps: 57, length: "5.412", winner: "Kimi Antonelli · ANT" },
  { round: 5, slug: "canada", flag: "🇨🇦", country: "加拿大", name: "加拿大大奖赛", circuit: "Circuit Gilles-Villeneuve", dates: "05.22 — 05.24", raceTime: "2026-05-24T20:00:00Z", laps: 70, length: "4.361", winner: "Kimi Antonelli · ANT" },
  { round: 6, slug: "monaco", flag: "🇲🇨", country: "摩纳哥", name: "摩纳哥大奖赛", circuit: "Circuit de Monaco", dates: "06.05 — 06.07", raceTime: "2026-06-07T13:00:00Z", laps: 78, length: "3.337", winner: "Kimi Antonelli · ANT" },
  { round: 7, slug: "barcelona-catalunya", flag: "🇪🇸", country: "西班牙 · 巴塞罗那", name: "巴塞罗那大奖赛", circuit: "Circuit de Barcelona-Catalunya", dates: "06.12 — 06.14", raceTime: "2026-06-14T13:00:00Z", laps: 66, length: "4.657", winner: "Lewis Hamilton · HAM" },
  { round: 8, slug: "austria", flag: "🇦🇹", country: "奥地利", name: "奥地利大奖赛", circuit: "Red Bull Ring", dates: "06.26 — 06.28", raceTime: "2026-06-28T13:00:00Z", laps: 71, length: "4.326", winner: "George Russell · RUS" },
  { round: 9, slug: "great-britain", flag: "🇬🇧", country: "英国", name: "英国大奖赛", circuit: "Silverstone Circuit", dates: "07.03 — 07.05", raceTime: "2026-07-05T14:00:00Z", laps: 52, length: "5.891", winner: "Charles Leclerc · LEC" },
  { round: 10, slug: "belgium", flag: "🇧🇪", country: "比利时", name: "比利时大奖赛", circuit: "Circuit de Spa-Francorchamps", dates: "07.17 — 07.19", raceTime: "2026-07-19T13:00:00Z", laps: 44, length: "7.004", winner: "Kimi Antonelli · ANT" },
  { round: 11, slug: "hungary", flag: "🇭🇺", country: "匈牙利", name: "匈牙利大奖赛", circuit: "Hungaroring", dates: "07.24 — 07.26", raceTime: "2026-07-26T13:00:00Z", laps: 70, length: "4.381", winner: "Lando Norris · NOR" },
  { round: 12, slug: "netherlands", flag: "🇳🇱", country: "荷兰", name: "荷兰大奖赛", circuit: "Circuit Zandvoort", dates: "08.21 — 08.23", raceTime: "2026-08-23T13:00:00Z", laps: 72, length: "4.259" },
  { round: 13, slug: "italy", flag: "🇮🇹", country: "意大利", name: "意大利大奖赛", circuit: "Autodromo Nazionale Monza", dates: "09.04 — 09.06", raceTime: "2026-09-06T13:00:00Z", laps: 53, length: "5.793" },
  { round: 14, slug: "spain", flag: "🇪🇸", country: "西班牙 · 马德里", name: "西班牙大奖赛", circuit: "Madring", dates: "09.11 — 09.13", raceTime: "2026-09-13T13:00:00Z", laps: 57, length: "5.416" },
  { round: 15, slug: "azerbaijan", flag: "🇦🇿", country: "阿塞拜疆", name: "阿塞拜疆大奖赛", circuit: "Baku City Circuit", dates: "09.24 — 09.26", raceTime: "2026-09-26T11:00:00Z", laps: 51, length: "6.003" },
  { round: 16, slug: "bahrain", flag: "🇲🇾", country: "马来西亚", name: "马来西亚巴林大奖赛", circuit: "Sepang International Circuit", dates: "10.02 — 10.04", raceTime: "2026-10-04T07:00:00Z", laps: 56, length: "5.543" },
  { round: 17, slug: "singapore", flag: "🇸🇬", country: "新加坡", name: "新加坡大奖赛", circuit: "Marina Bay Street Circuit", dates: "10.09 — 10.11", raceTime: "2026-10-11T12:00:00Z", laps: 62, length: "4.927" },
  { round: 18, slug: "united-states", flag: "🇺🇸", country: "美国 · 奥斯汀", name: "美国大奖赛", circuit: "Circuit of the Americas", dates: "10.23 — 10.25", raceTime: "2026-10-25T20:00:00Z", laps: 56, length: "5.513" },
  { round: 19, slug: "mexico", flag: "🇲🇽", country: "墨西哥", name: "墨西哥城大奖赛", circuit: "Autódromo Hermanos Rodríguez", dates: "10.30 — 11.01", raceTime: "2026-11-01T20:00:00Z", laps: 71, length: "4.304" },
  { round: 20, slug: "brazil", flag: "🇧🇷", country: "巴西", name: "圣保罗大奖赛", circuit: "Autódromo José Carlos Pace", dates: "11.06 — 11.08", raceTime: "2026-11-08T17:00:00Z", laps: 71, length: "4.309" },
  { round: 21, slug: "las-vegas", flag: "🇺🇸", country: "美国 · 拉斯维加斯", name: "拉斯维加斯大奖赛", circuit: "Las Vegas Strip Circuit", dates: "11.19 — 11.21", raceTime: "2026-11-22T04:00:00Z", laps: 50, length: "6.201" },
  { round: 22, slug: "qatar", flag: "🇶🇦", country: "卡塔尔", name: "卡塔尔大奖赛", circuit: "Lusail International Circuit", dates: "11.27 — 11.29", raceTime: "2026-11-29T16:00:00Z", laps: 57, length: "5.419" },
  { round: 23, slug: "united-arab-emirates", flag: "🇦🇪", country: "阿联酋", name: "阿布扎比大奖赛", circuit: "Yas Marina Circuit", dates: "12.04 — 12.06", raceTime: "2026-12-06T13:00:00Z", laps: 58, length: "5.281" },
];

const driverFlags = Object.fromEntries(fallbackDrivers.map((driver) => [driver.code, driver.flag]));
const driverNumbers = Object.fromEntries(fallbackDrivers.map((driver) => [driver.code, driver.number]));

let drivers = fallbackDrivers;
let constructors = fallbackConstructors;
let allDriversVisible = false;

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const beijingTime = (iso) => new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).format(new Date(iso));

function renderDrivers() {
  const list = document.querySelector("#driver-standings");
  list.innerHTML = drivers.map((driver, index) => {
    const color = teamColors[driver.team] || "#888";
    const hidden = index >= 10 && !allDriversVisible ? " hidden-driver" : "";
    return `
      <div class="standing-row${index === 0 ? " leader" : ""}${hidden}" style="--team:${color}">
        <div class="driver-cell">
          <span class="position">${escapeHtml(driver.position)}</span>
          <span class="driver-number">${escapeHtml(driver.number)}</span>
          <span class="driver-name"><strong>${escapeHtml(driver.name)}</strong><small>${escapeHtml(driver.flag)} · ${escapeHtml(driver.code)}</small></span>
        </div>
        <span class="team-cell">${escapeHtml(driver.team)}</span>
        <span class="points-cell">${escapeHtml(driver.points)} <small>PTS</small></span>
      </div>`;
  }).join("");
}

function renderConstructors() {
  const chart = document.querySelector("#constructor-standings");
  const leaderPoints = Number(constructors[0]?.points) || 1;
  chart.innerHTML = constructors.map((team) => {
    const color = teamColors[team.name] || "#888";
    const width = Math.max(1, (Number(team.points) / leaderPoints) * 100);
    return `
      <div class="constructor-row" style="--team:${color};--width:${width}%">
        <div class="constructor-copy">
          <span>${String(team.position).padStart(2, "0")}</span>
          <strong>${escapeHtml(team.name)}</strong>
          <b>${escapeHtml(team.points)} <small>PTS</small></b>
        </div>
        <div class="bar-track" aria-hidden="true"><span></span></div>
      </div>`;
  }).join("");
}

function getRaceState(race, nextRound, now) {
  if (race.round === nextRound) return "next";
  return new Date(race.raceTime) < now ? "completed" : "upcoming";
}

function renderCalendar(filter = "all") {
  const grid = document.querySelector("#race-grid");
  const now = new Date();
  const nextRace = races.find((race) => new Date(race.raceTime) > now);
  const nextRound = nextRace?.round;

  grid.innerHTML = races.map((race) => {
    const state = getRaceState(race, nextRound, now);
    const filterState = state === "next" ? "upcoming" : state;
    const hidden = filter !== "all" && filter !== filterState;
    const badge = state === "next" ? "下一站" : state === "completed" ? "已结束" : "待开赛";
    const detail = state === "completed" ? `<span>冠军</span><strong>${escapeHtml(race.winner || "赛果待更新")}</strong>` : `<span>正赛 · 北京时间</span><strong>${beijingTime(race.raceTime)}</strong>`;
    return `
      <article class="race-item${state === "next" ? " is-next" : ""}" data-state="${filterState}" ${hidden ? "hidden" : ""}>
        <div class="race-item-top">
          <span class="race-round">ROUND ${String(race.round).padStart(2, "0")}</span>
          <span class="race-badge ${state}">${badge}</span>
        </div>
        <div class="race-map-wrap">
          <img class="race-map" src="./assets/tracks/${race.slug}.png" width="700" height="394" loading="lazy" alt="${escapeHtml(race.circuit)} 赛道图" />
        </div>
        <div class="race-copy">
          <h3>${escapeHtml(race.flag)} ${escapeHtml(race.name)}</h3>
          <p><span>${escapeHtml(race.circuit)}</span><time datetime="${race.raceTime}">${escapeHtml(race.dates)}</time></p>
        </div>
        <div class="race-result">${detail}</div>
      </article>`;
  }).join("");
}

function updateHero() {
  const now = new Date();
  const nextRace = races.find((race) => new Date(race.raceTime) > now) || races[races.length - 1];
  const completed = races.filter((race) => new Date(race.raceTime) <= now).length;
  const target = new Date(nextRace.raceTime);
  const remaining = Math.max(0, target - now);
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining / 3_600_000) % 24);
  const minutes = Math.floor((remaining / 60_000) % 60);
  const seconds = Math.floor((remaining / 1_000) % 60);

  document.querySelector("#count-days").textContent = String(days).padStart(2, "0");
  document.querySelector("#count-hours").textContent = String(hours).padStart(2, "0");
  document.querySelector("#count-minutes").textContent = String(minutes).padStart(2, "0");
  document.querySelector("#count-seconds").textContent = String(seconds).padStart(2, "0");
  document.querySelector("#progress-label").textContent = `${completed} / ${races.length}`;
  document.querySelector("#progress-bar").style.width = `${(completed / races.length) * 100}%`;
  document.querySelector("#next-round").textContent = `ROUND ${nextRace.round}`;
  document.querySelector("#next-flag").textContent = nextRace.flag;
  document.querySelector("#next-country").textContent = nextRace.country;
  document.querySelector("#next-race-title").textContent = nextRace.name;
  document.querySelector("#next-circuit").textContent = nextRace.circuit;
  document.querySelector("#next-date").textContent = nextRace.dates;
  document.querySelector("#next-map").src = `./assets/tracks/${nextRace.slug}.png`;
  document.querySelector("#next-map").alt = `${nextRace.circuit} 赛道图`;
  document.querySelector("#fact-laps").textContent = nextRace.laps;
  document.querySelector("#fact-length").textContent = `${nextRace.length} km`;
  document.querySelector("#fact-time").textContent = beijingTime(nextRace.raceTime);
  document.querySelector("#official-race-link").href = `https://www.formula1.com/en/racing/${season}/${nextRace.slug}`;
}

async function fetchWithTimeout(url, timeout = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function syncStandings() {
  const base = `https://api.jolpi.ca/ergast/f1/${season}`;
  try {
    const [driverData, constructorData] = await Promise.all([
      fetchWithTimeout(`${base}/driverstandings.json`),
      fetchWithTimeout(`${base}/constructorstandings.json`),
    ]);

    const liveDrivers = driverData?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings;
    const liveConstructors = constructorData?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings;
    if (!Array.isArray(liveDrivers) || !Array.isArray(liveConstructors)) throw new Error("Invalid standings payload");

    drivers = liveDrivers.map((entry) => ({
      position: Number(entry.position),
      number: entry.Driver.permanentNumber || driverNumbers[entry.Driver.code] || "—",
      code: entry.Driver.code || "—",
      name: `${entry.Driver.givenName} ${entry.Driver.familyName}`,
      flag: driverFlags[entry.Driver.code] || "🏁",
      team: entry.Constructors?.[0]?.name || "—",
      points: Number(entry.points),
    }));
    constructors = liveConstructors.map((entry) => ({
      position: Number(entry.position),
      name: entry.Constructor.name,
      points: Number(entry.points),
    }));

    renderDrivers();
    renderConstructors();
    document.querySelector("#data-state").classList.add("online");
    document.querySelector("#data-updated").textContent = `积分已自动同步 · ${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
  } catch {
    document.querySelector("#data-updated").textContent = "本地快照 · 数据截至 2026 匈牙利站";
  }
}

document.querySelector("#show-all-drivers").addEventListener("click", (event) => {
  allDriversVisible = !allDriversVisible;
  event.currentTarget.setAttribute("aria-expanded", String(allDriversVisible));
  event.currentTarget.innerHTML = allDriversVisible ? "收起积分榜 <span>↑</span>" : "查看全部 22 位车手 <span>↓</span>";
  renderDrivers();
});

document.querySelectorAll(".calendar-filters button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".calendar-filters button").forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
    renderCalendar(button.dataset.filter);
  });
});

renderDrivers();
renderConstructors();
renderCalendar();
updateHero();
syncStandings();
setInterval(updateHero, 1000);
