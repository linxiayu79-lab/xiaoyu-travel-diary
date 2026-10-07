(function () {
  const config = window.XIAOYU_SUPABASE;
  const sdk = window.supabase;

  if (!config || !sdk) {
    return;
  }

  const supabase = sdk.createClient(config.url, config.publishableKey);
  const state = {
    session: null,
    isCreator: false,
    tripSlug: document.body.dataset.tripSlug || null
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const setText = (selector, value) => {
    if (!value) return;
    $$(selector).forEach((node) => {
      node.textContent = value;
    });
  };

  const setBackground = (selector, url) => {
    const node = $(selector);
    if (node && url) node.style.backgroundImage = `url('${url}')`;
  };

  async function selectTable(table, query) {
    try {
      const response = await query(supabase.from(table));
      if (response.error) {
        console.info(`[Supabase] ${table}:`, response.error.message);
        return [];
      }
      return response.data || [];
    } catch (error) {
      console.info(`[Supabase] ${table}:`, error.message);
      return [];
    }
  }

  async function initAuth() {
    const { data } = await supabase.auth.getSession();
    state.session = data.session;
    await refreshCreatorState();
    renderAuthPanels();

    supabase.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      await refreshCreatorState();
      renderAuthPanels();
      toggleCreatorControls();
    });
  }

  async function refreshCreatorState() {
    state.isCreator = false;
    if (!state.session?.user) return;

    const { data, error } = await supabase
      .from("site_creators")
      .select("user_id")
      .eq("user_id", state.session.user.id)
      .maybeSingle();

    state.isCreator = !error && Boolean(data);
  }

  function renderAuthPanels() {
    $$("[data-auth-panel]").forEach((panel) => {
      if (state.session?.user) {
        panel.innerHTML = `
          <div class="authstatus">
            <div>
              <small>已登录</small>
              <strong>${escapeHtml(state.session.user.email || "创作者账号")}</strong>
              <p>${state.isCreator ? "已获得创作者权限，可以编辑旅行内容。" : "账号已登录，等待在 Supabase 中加入创作者名单。"}</p>
            </div>
            <button class="btn" type="button" data-auth-logout>退出登录</button>
          </div>
        `;
        return;
      }

      panel.innerHTML = `
        <form class="authform" data-auth-form>
          <label>
            <span>邮箱</span>
            <input type="email" name="email" placeholder="输入创作者邮箱" required>
          </label>
          <button class="btn" type="submit">发送登录链接</button>
          <p data-auth-message>只会发送安全登录链接，不需要在网站里保存密码。</p>
        </form>
      `;
    });

    bindAuthEvents();
    toggleCreatorControls();
  }

  function bindAuthEvents() {
    $$("[data-auth-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const message = form.querySelector("[data-auth-message]");
        const email = new FormData(form).get("email");
        message.textContent = "正在发送登录链接...";

        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.href.split("#")[0] }
        });

        message.textContent = error
          ? `发送失败：${error.message}`
          : "登录链接已发送，请打开邮箱完成登录。";
      });
    });

    $$("[data-auth-logout]").forEach((button) => {
      button.addEventListener("click", () => supabase.auth.signOut());
    });
  }

  function toggleCreatorControls() {
    $$("[data-admin-only]").forEach((node) => {
      node.hidden = !state.isCreator;
    });
  }

  async function loadTrips() {
    const trips = await selectTable("trips", (table) =>
      table
        .select("slug,title,subtitle,summary,cover_url,date_label,duration_label,status,display_order")
        .order("display_order", { ascending: true })
    );

    const list = $("#tripsList");
    if (!list || trips.length === 0) return;

    list.innerHTML = trips
      .map((trip) => `
        <a class="trip" href="${escapeHtml(trip.slug || "japan")}.html">
          <div class="tripimg" style="background-image:url('${escapeHtml(trip.cover_url)}')"></div>
          <div class="tripbody">
            <small>${escapeHtml(trip.status || "TRIP")}</small>
            <h3>${escapeHtml(trip.title)}</h3>
            <p>${escapeHtml(trip.subtitle || trip.summary)}</p>
            <div class="tripmeta">
              <span>${escapeHtml(trip.duration_label)}</span>
              <span>${escapeHtml(trip.date_label)}</span>
            </div>
          </div>
        </a>
      `)
      .join("");
  }

  async function loadTripDetail() {
    if (!state.tripSlug) return;

    const [trip] = await selectTable("trips", (table) =>
      table.select("*").eq("slug", state.tripSlug).limit(1)
    );

    if (trip) {
      setText("[data-trip-title]", trip.title);
      setText("[data-trip-subtitle]", trip.subtitle);
      setText("[data-trip-date]", trip.date_label);
      setText("[data-trip-duration]", trip.duration_label);
      setText("[data-trip-places-count]", trip.places_count);
      setText("[data-trip-budget]", trip.budget_label);
      setBackground("[data-trip-hero]", trip.cover_url);
    }

    await Promise.all([
      loadPlaces(),
      loadPhotos(),
      loadItinerary(),
      loadLogs(),
      loadExpenses()
    ]);
  }

  async function loadPlaces() {
    const places = await selectTable("places", (table) =>
      table.select("name,label,display_order").eq("trip_slug", state.tripSlug).order("display_order")
    );
    const list = $("#placesList");
    if (!list || places.length === 0) return;
    list.innerHTML = places.map((place) => `<span class="place">${escapeHtml(place.label || place.name)}</span>`).join("");
  }

  async function loadPhotos() {
    const photos = await selectTable("photos", (table) =>
      table.select("image_url,caption,display_order").eq("trip_slug", state.tripSlug).order("display_order")
    );
    const list = $("#photosList");
    if (!list || photos.length === 0) return;
    list.innerHTML = photos
      .map((photo) => `<div class="photo" title="${escapeHtml(photo.caption)}" style="background-image:url('${escapeHtml(photo.image_url)}')"></div>`)
      .join("");
  }

  async function loadItinerary() {
    const days = await selectTable("itinerary_days", (table) =>
      table.select("day_label,title,body,display_order").eq("trip_slug", state.tripSlug).order("display_order")
    );
    const list = $("#itineraryList");
    if (!list || days.length === 0) return;
    list.innerHTML = days
      .map((day) => `<div class="day"><h3>${escapeHtml(day.day_label)} · ${escapeHtml(day.title)}</h3><p>${escapeHtml(day.body)}</p></div>`)
      .join("");
  }

  async function loadLogs() {
    const logs = await selectTable("travel_logs", (table) =>
      table.select("day_label,entry_date,title,body,display_order").eq("trip_slug", state.tripSlug).order("display_order")
    );
    const list = $("#logsList");
    if (!list || logs.length === 0) return;
    list.innerHTML = logs
      .map((log) => `
        <article class="log">
          <small>${escapeHtml(log.day_label)}${log.entry_date ? ` · ${escapeHtml(log.entry_date)}` : ""}</small>
          <h3>${escapeHtml(log.title)}</h3>
          <p>${escapeHtml(log.body)}</p>
        </article>
      `)
      .join("");
  }

  async function loadExpenses() {
    const expenses = await selectTable("expenses", (table) =>
      table.select("category,amount,currency,display_order").eq("trip_slug", state.tripSlug).order("display_order")
    );
    const list = $("#expensesList");
    if (!list || expenses.length === 0) return;

    const total = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    list.innerHTML = expenses
      .map((item) => `
        <div class="row">
          <span>${escapeHtml(item.category)}</span>
          <span>${escapeHtml(item.currency || "¥")} ${Number(item.amount || 0).toLocaleString("zh-CN")}</span>
        </div>
      `)
      .join("") + `<div class="row total"><span>TOTAL</span><span>¥ ${total.toLocaleString("zh-CN")}</span></div>`;
  }

  function bindAdminForms() {
    $$("[data-insert-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.isCreator) return;

        const table = form.dataset.insertForm;
        const message = form.querySelector("[data-form-message]");
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.trip_slug = state.tripSlug;

        if (payload.amount) payload.amount = Number(payload.amount);

        message.textContent = "正在保存...";
        const { error } = await supabase.from(table).insert(payload);
        if (error) {
          message.textContent = `保存失败：${error.message}`;
          return;
        }

        message.textContent = "已保存。";
        form.reset();
        await loadTripDetail();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await initAuth();
    await loadTrips();
    await loadTripDetail();
    bindAdminForms();
  });
})();
