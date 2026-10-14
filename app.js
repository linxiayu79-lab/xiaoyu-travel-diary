(function () {
  const config = window.XIAOYU_SUPABASE;
  const sdk = window.supabase;
  if (!config || !sdk) return;

  const supabase = sdk.createClient(config.url, config.publishableKey);

  const state = {
    session: null,
    isCreator: false,
    tripSlug: new URLSearchParams(location.search).get("slug")
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const escapeHtml = (v) =>
    String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  let toastTimer = null;
  function toast(msg, isError) {
    let node = $(".toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "toast";
      document.body.appendChild(node);
    }
    node.textContent = msg;
    node.classList.toggle("error", !!isError);
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), isError ? 4500 : 2200);
  }

  async function selectTable(table, query) {
    try {
      const res = await query(supabase.from(table));
      if (res.error) {
        console.info(`[Supabase] ${table}:`, res.error.message);
        return [];
      }
      return res.data || [];
    } catch (e) {
      console.info(`[Supabase] ${table}:`, e.message);
      return [];
    }
  }

  async function uploadImage(file, folder) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from("travel-photos")
      .upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;
    return supabase.storage.from("travel-photos").getPublicUrl(path).data.publicUrl;
  }

  const isTripPage = () => (location.pathname.split("/").pop() || "index.html") === "trip.html";

  // ================= 认证 =================

  async function initAuth() {
    const { data } = await supabase.auth.getSession();
    state.session = data.session;
    await refreshCreatorState();
    renderAuthPanels();
    refreshAdminUI();

    supabase.auth.onAuthStateChange(async (event, session) => {
      state.session = session;
      await refreshCreatorState();
      renderAuthPanels();
      refreshAdminUI();
      if (isTripPage()) await loadTripDetail();
      else await loadTrips();

      // 点邮件里的重置密码链接回来时，显示"设置新密码"界面
      if (event === "PASSWORD_RECOVERY") {
        $$("[data-auth-panel]").forEach((panel) => {
          panel.innerHTML = `
            <div class="authstatus">
              <div>
                <small>验证成功</small>
                <strong>请设置新密码</strong>
                <p>设置完成后，手机和电脑都可以用「邮箱 + 新密码」直接登录，不需要再收邮件。</p>
              </div>
            </div>
            <form class="authform" data-reset-password-form>
              <label><span>新密码</span><input type="password" name="password" placeholder="至少 6 位" minlength="6" required></label>
              <label><span>再次输入新密码</span><input type="password" name="confirm" placeholder="再输一遍" required></label>
              <button class="btn" type="submit">设置新密码</button>
              <p data-auth-message></p>
            </form>`;
        });
        bindAuthEvents();
      }
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
              <p>${state.isCreator ? "已获得创作者权限，可以添加、修改和删除内容。" : "已登录，但还不是创作者。点击「认领创作者身份」即可开始管理（仅第一位登录者可以认领）。"}</p>
            </div>
            <div class="authbtns">
              ${state.isCreator ? "" : `<button class="btn" type="button" data-claim-creator>认领创作者身份</button>`}
              <button class="btn" type="button" data-auth-logout>退出登录</button>
            </div>
          </div>`;
        return;
      }
      panel.innerHTML = `
        <div class="authtabs">
          <button class="btn small tablink active" type="button" data-authtab="login">密码登录</button>
          <button class="btn small tablink" type="button" data-authtab="register">注册账号</button>
          <button class="btn small tablink" type="button" data-authtab="magic">邮箱链接（备用）</button>
        </div>
        <form class="authform" data-auth-login-form>
          <label><span>邮箱</span><input type="email" name="email" placeholder="你的邮箱" required></label>
          <label><span>密码</span><input type="password" name="password" placeholder="密码" required></label>
          <button class="btn" type="submit">登录</button>
          <p data-auth-message></p>
          <p><button class="linkbtn" type="button" data-auth-reset>忘记密码？点这里发送重置链接</button></p>
        </form>
        <form class="authform" data-auth-register-form hidden>
          <label><span>邮箱</span><input type="email" name="email" placeholder="你的邮箱" required></label>
          <label><span>设置密码</span><input type="password" name="password" placeholder="至少 6 位" minlength="6" required></label>
          <button class="btn" type="submit">注册账号</button>
          <p data-auth-message></p>
        </form>
        <form class="authform" data-auth-magic-form hidden>
          <label><span>邮箱</span><input type="email" name="email" placeholder="输入创作者邮箱" required></label>
          <button class="btn" type="submit">发送登录链接</button>
          <p data-auth-message>只会发送安全登录链接，不需要在网站里保存密码。</p>
        </form>`;
    });
    bindAuthEvents();
  }

  function bindAuthEvents() {
    // 标签切换
    $$("[data-authtab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.authtab;
        $$("[data-authtab]").forEach((b) => b.classList.toggle("active", b === btn));
        const panel = btn.closest("[data-auth-panel]");
        if (!panel) return;
        panel.querySelector("[data-auth-login-form]").hidden = target !== "login";
        panel.querySelector("[data-auth-register-form]").hidden = target !== "register";
        panel.querySelector("[data-auth-magic-form]").hidden = target !== "magic";
      });
    });

    // 邮箱 + 密码登录（手机电脑通用，不跳转）
    $$("[data-auth-login-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const msg = form.querySelector("[data-auth-message]");
        const { email, password } = Object.fromEntries(new FormData(form).entries());
        msg.textContent = "正在登录...";
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (error.message.includes("Invalid login credentials")) {
            msg.textContent = "邮箱或密码不对；如果是第一次使用，请先在电脑上用「忘记密码？」设置密码。";
          } else {
            msg.textContent = `登录失败：${error.message}`;
          }
          return;
        }
        msg.textContent = "登录成功！";
        // onAuthStateChange 会自动刷新登录状态
      });
    });

    // 注册账号（电脑端设置密码，手机端即可用密码登录）
    $$("[data-auth-register-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const msg = form.querySelector("[data-auth-message]");
        const { email, password } = Object.fromEntries(new FormData(form).entries());
        msg.textContent = "正在创建账号...";
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          if (error.message.includes("already registered") || error.message.includes("User already")) {
            msg.textContent = "这个邮箱已经注册过，请直接登录；忘记密码就点「忘记密码？」重置。";
          } else {
            msg.textContent = `注册失败：${error.message}`;
          }
          return;
        }
        msg.textContent = data.session
          ? "注册成功，已自动登录！"
          : "注册成功！如果收到确认邮件，请先在电脑上点邮件里的确认链接，然后即可用密码登录。";
      });
    });

    // 发送邮箱链接（备用）
    $$("[data-auth-magic-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const msg = form.querySelector("[data-auth-message]");
        const email = new FormData(form).get("email");
        msg.textContent = "正在发送登录链接...";
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: location.href.split("#")[0] }
        });
        msg.textContent = error
          ? `发送失败：${error.message}`
          : "登录链接已发送，请打开邮箱完成登录。";
      });
    });

    // 忘记密码：发送重置链接（电脑收信设置新密码）
    $$("[data-auth-reset]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const panel = btn.closest("[data-auth-panel]");
        const email = panel?.querySelector("[data-auth-login-form] [name=email]")?.value;
        if (!email) {
          const msg = panel?.querySelector("[data-auth-login-form] [data-auth-message]");
          if (msg) msg.textContent = "请先在上面输入邮箱，再点重置。";
          return;
        }
        const msg = panel?.querySelector("[data-auth-login-form] [data-auth-message]");
        if (msg) msg.textContent = "正在发送重置链接...";
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: location.href.split("#")[0]
        });
        if (msg) {
          msg.textContent = error
            ? `发送失败：${error.message}`
            : "重置链接已发送，请到邮箱（电脑）打开并设置新密码。";
        }
      });
    });

    $$("[data-auth-logout]").forEach((b) => b.addEventListener("click", () => supabase.auth.signOut()));
    $$("[data-claim-creator]").forEach((b) => b.addEventListener("click", claimCreator));

    // 设置新密码（点邮件重置链接后出现）
    $$("[data-reset-password-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const msg = form.querySelector("[data-auth-message]");
        const { password, confirm } = Object.fromEntries(new FormData(form).entries());
        if (password !== confirm) {
          msg.textContent = "两次输入的密码不一致。";
          return;
        }
        if (password.length < 6) {
          msg.textContent = "密码至少 6 位。";
          return;
        }
        msg.textContent = "正在设置...";
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          msg.textContent = `设置失败：${error.message}`;
          return;
        }
        toast("密码设置成功！现在可以用邮箱 + 新密码登录了。");
        await refreshCreatorState();
        renderAuthPanels();
        refreshAdminUI();
      });
    });
  }

  async function claimCreator() {
    if (!state.session?.user) return;
    const { error } = await supabase
      .from("site_creators")
      .insert({ user_id: state.session.user.id, email: state.session.user.email });
    if (error) {
      toast(`认领失败：${error.message}`, true);
      return;
    }
    state.isCreator = true;
    toast("恭喜，你现在是创作者了！");
    renderAuthPanels();
    refreshAdminUI();
  }

  function refreshAdminUI() {
    $$("[data-admin-only]").forEach((node) => {
      node.hidden = !state.isCreator;
    });
  }

  // ================= 首页 =================

  async function loadHeroCover() {
    const rows = await selectTable("site_settings", (t) =>
      t.select("value").eq("key", "hero_cover").limit(1)
    );
    const hero = $(".hero");
    if (hero && rows[0]?.value) {
      hero.style.backgroundImage = `linear-gradient(rgba(255,255,255,.45),rgba(247,245,240,.92)),url('${rows[0].value}')`;
    }
  }

  async function loadTrips() {
    const trips = await selectTable("trips", (t) =>
      t.select("*").order("display_order", { ascending: true })
    );
    const list = $("#tripsList");
    if (!list) return;

    if (!trips.length) {
      list.innerHTML = `<div class="trip empty"><div><strong>还没有旅行记录</strong><br>${state.isCreator ? "使用下方「新建旅行」开始记录。" : "登录创作者账号后即可添加旅行。"}</div></div>`;
      refreshAdminUI();
      return;
    }

    list.innerHTML = trips
      .map((trip) => `
        <div class="tripwrap" data-trip-slug="${escapeHtml(trip.slug)}">
          <a class="trip" href="trip.html?slug=${encodeURIComponent(trip.slug)}">
            <div class="tripimg" style="background-image:url('${escapeHtml(trip.cover_url || "")}')"></div>
            <div class="tripbody">
              <small>${escapeHtml(trip.status || "TRIP")}</small>
              <h3>${escapeHtml(trip.title)}</h3>
              <p>${escapeHtml(trip.subtitle || trip.summary || "")}</p>
              <div class="tripmeta">
                <span>${escapeHtml(trip.duration_label || "")}</span>
                <span>${escapeHtml(trip.date_label || "")}</span>
              </div>
            </div>
          </a>
          <div class="tripadmin" data-admin-only hidden>
            <button class="btn small" type="button" data-trip-up>↑ 上移</button>
            <button class="btn small" type="button" data-trip-down>↓ 下移</button>
            <button class="btn small danger" type="button" data-trip-del>删除</button>
          </div>
        </div>
      `)
      .join("");
    refreshAdminUI();
  }

  function bindNewTripForm() {
    const form = $("[data-new-trip-form]");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = form.querySelector("[data-form-message]");
      if (!state.isCreator) {
        msg.textContent = "请先登录并认领创作者身份（见上方「创作者」区）。";
        return;
      }
      const fd = new FormData(form);
      const slug = String(fd.get("slug") || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-");
      if (!slug) {
        msg.textContent = "请填写页面标识，例如 beijing-2023。";
        return;
      }
      const payload = {
        slug,
        title: fd.get("title") || slug,
        subtitle: fd.get("subtitle") || "",
        date_label: fd.get("date_label") || "",
        duration_label: fd.get("duration_label") || "",
        status: fd.get("status") || "TRIP",
        display_order: Date.now()
      };
      const file = form.querySelector("input[type=file]").files[0];
      msg.textContent = "正在保存...";
      if (file) {
        try {
          payload.cover_url = await uploadImage(file, "trip-covers");
        } catch (err) {
          msg.textContent = `封面上传失败：${err.message}`;
          return;
        }
      } else if (fd.get("cover_url")) {
        payload.cover_url = fd.get("cover_url");
      }
      const { error } = await supabase.from("trips").insert(payload);
      if (error) {
        msg.textContent = `保存失败：${error.message}`;
        toast(`保存失败：${error.message}`, true);
        return;
      }
      msg.textContent = "已创建，正在刷新...";
      toast("旅行已创建！");
      setTimeout(() => location.reload(), 800);
    });
  }

  function bindHeroCoverForm() {
    const form = $("[data-hero-cover-form]");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = form.querySelector("[data-form-message]");
      if (!state.isCreator) {
        msg.textContent = "请先登录并认领创作者身份。";
        return;
      }
      const file = form.querySelector("input[type=file]").files[0];
      if (!file) {
        msg.textContent = "请先选择一张图片。";
        return;
      }
      msg.textContent = "正在上传...";
      try {
        const url = await uploadImage(file, "site");
        const { error } = await supabase
          .from("site_settings")
          .upsert({ key: "hero_cover", value: url, updated_at: new Date().toISOString() }, { onConflict: "key" });
        if (error) throw error;
        msg.textContent = "已保存，正在刷新...";
        toast("首页封面已更新！");
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        msg.textContent = `保存失败：${err.message}`;
      }
    });
  }

  // ================= 详情页 =================

  async function loadTripDetail() {
    if (!state.tripSlug) {
      const root = $("#tripRoot");
      if (root) {
        root.innerHTML = `<div class="empty" style="min-height:40vh"><div><strong>请从首页选择一个旅行</strong><br><a class="btn" href="index.html">← 返回我的旅行</a></div></div>`;
      }
      return;
    }

    const [trip] = await selectTable("trips", (t) =>
      t.select("*").eq("slug", state.tripSlug).limit(1)
    );

    const root = $("#tripRoot");
    if (!trip) {
      if (root) {
        root.innerHTML = `<div class="empty" style="min-height:40vh"><div><strong>没有找到这个旅行</strong><br><a class="btn" href="index.html">← 返回我的旅行</a></div></div>`;
      }
      return;
    }

    document.title = `${trip.title} · 小雨的旅行日记`;
    const setText = (sel, val) => {
      if (val) $$(sel).forEach((n) => (n.textContent = val));
    };
    setText("[data-trip-title]", trip.title);
    setText("[data-trip-subtitle]", trip.subtitle);
    setText("[data-trip-date]", trip.date_label);
    setText("[data-trip-duration]", trip.duration_label);

    const hero = $("[data-trip-hero]");
    if (hero && trip.cover_url) {
      hero.style.backgroundImage = `url('${trip.cover_url}')`;
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
    const places = await selectTable("places", (t) =>
      t.select("id,name,label,display_order").eq("trip_slug", state.tripSlug).order("display_order")
    );
    const list = $("#placesList");
    if (!list) return;
    $$("[data-trip-places-count]").forEach((n) => (n.textContent = places.length));
    if (!places.length) {
      list.innerHTML = `<span class="empty-mini">还没有地点，登录后在下方添加。</span>`;
      return;
    }
    list.innerHTML = places
      .map((p) => `
        <span class="place">${escapeHtml(p.label || p.name)}
          <button class="place-del" type="button" data-del="${p.id}" data-del-table="places" title="删除" data-admin-only hidden>×</button>
        </span>`)
      .join("");
    refreshAdminUI();
  }

  async function loadPhotos() {
    const photos = await selectTable("photos", (t) =>
      t.select("id,image_url,caption,display_order").eq("trip_slug", state.tripSlug).order("display_order")
    );
    const list = $("#photosList");
    if (!list) return;
    if (!photos.length) {
      list.innerHTML = `<div class="photo placeholder">还没有照片，登录后在下方上传</div>`;
      return;
    }
    list.innerHTML = photos
      .map((p) => `
        <div class="photo" title="${escapeHtml(p.caption || "")}" style="background-image:url('${escapeHtml(p.image_url)}')">
          <button class="photo-del" type="button" data-del="${p.id}" data-del-table="photos" title="删除照片" data-admin-only hidden>×</button>
        </div>`)
      .join("");
    refreshAdminUI();
  }

  async function loadItinerary() {
    const days = await selectTable("itinerary_days", (t) =>
      t.select("id,day_label,title,body,display_order").eq("trip_slug", state.tripSlug).order("display_order")
    );
    const list = $("#itineraryList");
    if (!list) return;
    if (!days.length) {
      list.innerHTML = `<div class="day"><h3>还没有行程</h3><p>登录后可在下方添加行程。</p></div>`;
      return;
    }
    list.innerHTML = days
      .map((d) => `
        <div class="day">
          <h3>${escapeHtml(d.day_label || "")}${d.title ? ` · ${escapeHtml(d.title)}` : ""}</h3>
          <p>${escapeHtml(d.body || "")}</p>
          <button class="item-del" type="button" data-del="${d.id}" data-del-table="itinerary_days" data-admin-only hidden>删除</button>
        </div>`)
      .join("");
    refreshAdminUI();
  }

  async function loadLogs() {
    const logs = await selectTable("travel_logs", (t) =>
      t.select("id,day_label,entry_date,title,body,display_order").eq("trip_slug", state.tripSlug).order("display_order")
    );
    const list = $("#logsList");
    if (!list) return;
    if (!logs.length) {
      list.innerHTML = `<article class="log"><small>NO ENTRIES</small><h3>还没有日志</h3><p>登录后可在下方写下第一篇。</p></article>`;
      return;
    }
    list.innerHTML = logs
      .map((l) => `
        <article class="log">
          <small>${escapeHtml(l.day_label || "")}${l.entry_date ? ` · ${escapeHtml(l.entry_date)}` : ""}</small>
          <h3>${escapeHtml(l.title)}</h3>
          <p>${escapeHtml(l.body || "")}</p>
          <button class="item-del" type="button" data-del="${l.id}" data-del-table="travel_logs" data-admin-only hidden>删除</button>
        </article>`)
      .join("");
    refreshAdminUI();
  }

  async function loadExpenses() {
    const expenses = await selectTable("expenses", (t) =>
      t.select("id,category,amount,currency,display_order").eq("trip_slug", state.tripSlug).order("display_order")
    );
    const list = $("#expensesList");
    if (!list) return;

    const total = expenses.reduce((s, i) => s + Number(i.amount || 0), 0);
    $$("[data-trip-budget]").forEach((n) => (n.textContent = `¥ ${total.toLocaleString("zh-CN")}`));

    if (!expenses.length) {
      list.innerHTML = `<div class="row"><span>还没有花费记录</span><span>¥ 0</span></div><div class="row total"><span>TOTAL</span><span>¥ 0</span></div>`;
      return;
    }
    list.innerHTML =
      expenses
        .map((i) => `
          <div class="row">
            <span>${escapeHtml(i.category)} <button class="item-del inline" type="button" data-del="${i.id}" data-del-table="expenses" data-admin-only hidden>删除</button></span>
            <span>${escapeHtml(i.currency || "¥")} ${Number(i.amount || 0).toLocaleString("zh-CN")}</span>
          </div>`)
        .join("") +
      `<div class="row total"><span>TOTAL</span><span>¥ ${total.toLocaleString("zh-CN")}</span></div>`;
    refreshAdminUI();
  }

  // ================= 添加表单 =================

  function bindInsertForms() {
    $$("[data-insert-form]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const msg = form.querySelector("[data-form-message]");
        if (!state.isCreator) {
          msg.textContent = "请先登录并认领创作者身份（见上方「创作者」区）。";
          return;
        }
        const table = form.dataset.insertForm;
        const payload = Object.fromEntries(new FormData(form).entries());
        payload.trip_slug = state.tripSlug;
        if (payload.amount) payload.amount = Number(payload.amount);
        payload.display_order = Date.now();

        // 照片表单：支持从文件夹多选上传
        const fileInput = form.querySelector("input[type=file]");
        if (fileInput && fileInput.files.length) {
          msg.textContent = "正在上传照片...";
          try {
            const files = Array.from(fileInput.files);
            const caption = form.querySelector("[name=caption]")?.value || "";
            for (let i = 0; i < files.length; i++) {
              const url = await uploadImage(files[i], `trip-${state.tripSlug}`);
              const { error } = await supabase.from("photos").insert({
                trip_slug: state.tripSlug,
                image_url: url,
                caption,
                display_order: Date.now() + i
              });
              if (error) throw error;
            }
            msg.textContent = "照片已上传保存，正在刷新...";
            toast("照片已保存！");
            setTimeout(() => location.reload(), 800);
          } catch (err) {
            msg.textContent = `保存失败：${err.message}`;
            toast(`保存失败：${err.message}`, true);
          }
          return;
        }
        if (fileInput) {
          msg.textContent = "请先选择照片文件（可从文件夹多选）。";
          return;
        }

        msg.textContent = "正在保存...";
        const { error } = await supabase.from(table).insert(payload);
        if (error) {
          msg.textContent = `保存失败：${error.message}`;
          toast(`保存失败：${error.message}`, true);
          return;
        }
        msg.textContent = "已保存，正在刷新...";
        toast("已保存！");
        setTimeout(() => location.reload(), 800);
      });
    });
  }

  function bindTripCoverForm() {
    const form = $("[data-cover-form]");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = form.querySelector("[data-form-message]");
      if (!state.isCreator) {
        msg.textContent = "请先登录并认领创作者身份。";
        return;
      }
      const file = form.querySelector("input[type=file]").files[0];
      if (!file) {
        msg.textContent = "请先选择一张图片。";
        return;
      }
      msg.textContent = "正在上传...";
      try {
        const url = await uploadImage(file, `trip-${state.tripSlug}-cover`);
        const { error } = await supabase
          .from("trips")
          .update({ cover_url: url })
          .eq("slug", state.tripSlug);
        if (error) throw error;
        msg.textContent = "已保存，正在刷新...";
        toast("封面已更新！");
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        msg.textContent = `保存失败：${err.message}`;
        toast(`保存失败：${err.message}`, true);
      }
    });
  }

  // ================= 删除与排序（事件委托） =================

  async function moveTrip(wrap, delta) {
    const slug = wrap.dataset.tripSlug;
    const trips = await selectTable("trips", (t) =>
      t.select("id,slug,display_order").order("display_order", { ascending: true })
    );
    const idx = trips.findIndex((t) => t.slug === slug);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= trips.length) return;
    const a = trips[idx];
    const b = trips[target];
    const { error } = await supabase.from("trips").update({ display_order: b.display_order }).eq("id", a.id);
    if (!error) await supabase.from("trips").update({ display_order: a.display_order }).eq("id", b.id);
    if (error) {
      toast(`调整失败：${error.message}`, true);
      return;
    }
    toast("顺序已更新，正在刷新...");
    setTimeout(() => location.reload(), 600);
  }

  function bindTripAdminEvents() {
    document.addEventListener("click", async (e) => {
      const wrap = e.target.closest(".tripwrap");
      if (!wrap) return;

      if (e.target.closest("[data-trip-up]")) {
        await moveTrip(wrap, -1);
        return;
      }
      if (e.target.closest("[data-trip-down]")) {
        await moveTrip(wrap, 1);
        return;
      }
      if (e.target.closest("[data-trip-del]")) {
        if (!state.isCreator) return;
        if (!confirm("确定删除这个旅行吗？它下面的地点、照片、日志、花费也会一起删除。")) return;
        const { error } = await supabase.from("trips").delete().eq("slug", wrap.dataset.tripSlug);
        if (error) {
          toast(`删除失败：${error.message}`, true);
          return;
        }
        toast("已删除，正在刷新...");
        setTimeout(() => location.reload(), 600);
      }
    });
  }

  function bindDeleteEvents() {
    document.addEventListener("click", async (e) => {
      const del = e.target.closest("[data-del]");
      if (!del) return;
      if (!state.isCreator) return;
      if (!confirm("确定删除这条记录吗？")) return;
      const table = del.dataset.delTable;
      const { error } = await supabase.from(table).delete().eq("id", del.dataset.del);
      if (error) {
        toast(`删除失败：${error.message}`, true);
        return;
      }
      toast("已删除，正在刷新...");
      setTimeout(() => location.reload(), 600);
    });
  }

  // ================= 启动 =================

  document.addEventListener("DOMContentLoaded", async () => {
    await initAuth();

    if (isTripPage()) {
      bindInsertForms();
      bindTripCoverForm();
      bindDeleteEvents();
      await loadTripDetail();
    } else {
      loadHeroCover();
      bindNewTripForm();
      bindHeroCoverForm();
      bindTripAdminEvents();
      bindDeleteEvents();
      await loadTrips();
    }
  });
})();
