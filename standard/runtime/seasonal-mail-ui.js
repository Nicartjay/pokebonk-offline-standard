// Original mailbox/card classes and original framed-avatar renderer. Everything
// shown here comes from the bundled catalog and the local durable save.
export function openSeasonalMailbox(app, {mount, appearance, icon}) {
  if (app.run) return false;
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const root = el("div", null, "ml-wrap scroll offline-mail-wrap");
  let busy = false;
  function render(focusId) {
    const scroll = root.scrollTop, view = app.backend.seasonalMailbox();
    root.replaceChildren();
    const current = el("section", null, "offline-mail-current panel");
    current.append(icon("mail", 28));
    const detail = el("div");
    const archived = view.current.number <= view.archiveThrough;
    detail.append(el("b", archived ? `Seasons 1–${view.archiveThrough} · open archive` : `${view.current.name} is underway`),
      el("p", archived ?
        (view.current.giftAnnounced ? "All bundled seasonal archive gifts are open to every offline player. No past participation or online rank is required." :
          `All defined archive gifts are open to every offline player. No separate ${view.current.name} cosmetic pack is defined in this snapshot yet.`) :
        view.current.runs ?
        `${view.current.runs} qualifying ${view.current.runs === 1 ? "run" : "runs"} recorded. Future seasonal gifts arrive with reviewed app updates.` :
        "Finish a run lasting at least 60 seconds, or win, to record your participation for future seasonal gifts."));
    current.append(detail, el("span", "SEASON " + view.current.number, "offline-mail-season-chip"));
    root.append(current);
    for (const message of view.messages) {
      const card = el("article", null, "panel ml-card offline-mail-card" + (!message.read ? " new" : ""));
      card.style.setProperty("--d", (message.season - 1) * .05 + "s");
      const preview = el("div", null, "offline-mail-preview");
      preview.append(appearance({avatar: message.previewAvatar || undefined, frame: message.previewFrame, size: 76}));
      card.append(preview);
      const text = el("div", null, "ml-tx");
      const heading = el("h3", message.title);
      heading.id = "offline-mail-" + message.id;
      card.setAttribute("aria-labelledby", heading.id);
      text.append(el("small", `PokéBonk Offline · Season ${message.season} archive`),
        heading, el("p", message.text, "ml-text"),
        el("p", "Includes: " + message.rewards.map(reward => reward.name).join(" · "), "offline-mail-includes"));
      if (message.rewards.filter(reward => reward.id.startsWith("frame:")).length > 1) {
        const gallery = el("div", null, "offline-mail-frame-gallery");
        gallery.setAttribute("aria-label", "Season " + message.season + " frame previews");
        for (const reward of message.rewards.filter(reward => reward.id.startsWith("frame:"))) {
          const frame = el("span", null, "offline-mail-frame");
          frame.title = reward.name;
          frame.setAttribute("aria-label", reward.name);
          frame.append(appearance({frame: reward.id.slice(6), size: 34}));
          gallery.append(frame);
        }
        text.append(gallery);
      }
      card.append(text);
      if (message.state === "available") {
        const claim = el("button", "Claim", "btn green offline-mail-claim");
        claim.type = "button";
        claim.dataset.seasonalGift = message.id;
        claim.disabled = busy;
        claim.setAttribute("aria-label", `Claim Season ${message.season} gift`);
        claim.addEventListener("click", async () => {
          if (busy) return;
          busy = true;
          for (const button of root.querySelectorAll(".offline-mail-claim")) button.disabled = true;
          claim.textContent = "Saving…";
          try {
            const result = await app.backend.claimSeasonalGift(app.meta.account, message.id);
            app.meta.adopt(result.profile);
            app.notice(`Season ${message.season} gift saved. Equip it from Appearance.`);
          } catch (error) { app.notice(`Gift not claimed: ${error.message}`); }
          finally { busy = false; if (root.isConnected) render(message.id); }
        });
        card.append(claim);
      } else {
        const status = el("span", message.state === "claimed" ? "Claimed" :
          message.state === "owned" ? "Owned" : "Preserved", "chip ml-state accepted offline-mail-state");
        status.dataset.seasonalGift = message.id;
        status.tabIndex = -1;
        status.setAttribute("role", "status");
        card.append(status);
      }
      root.append(card);
    }
    if (!view.messages.length) {
      const empty = el("section", null, "panel bd-empty offline-mail-empty");
      empty.append(icon("mail", 64), el("h3", "Your mailbox is empty"),
        el("p", "Eligible seasonal gifts will appear here when they are included in an app update."));
      root.append(empty);
    }
    root.append(el("p", `Seasons 1–${view.archiveThrough} are covered by the offline archive. Claim once per profile; no expiry, online ranks or clan membership. Already-owned items are never duplicated.`, "ml-note offline-mail-note"));
    root.scrollTop = scroll;
    if (focusId) [...root.querySelectorAll("[data-seasonal-gift]")]
      .find(node => node.dataset.seasonalGift === focusId)?.focus({preventScroll: true});
  }
  render();
  mount(root);
  // Reading and claiming are separate durable operations. A failed read write
  // never hides a message or shows a reward as claimed.
  app.backend.readSeasonalMail().catch(error => app.notice(`Could not mark mail as read: ${error.message}`));
  return true;
}
