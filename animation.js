/*
 * Popmotion spring interaction.
 * Currency/item cards can be gently dragged and spring back on release.
 * If the CDN library is unavailable, the rest of the website still works.
 */

function enableSpringCards() {
  if (!window.popmotion || !window.popmotion.styler || !window.popmotion.pointer || !window.popmotion.spring) {
    return;
  }

  const { styler, pointer, spring, listen } = window.popmotion;

  document.querySelectorAll("[data-spring-card]").forEach(card => {
    if (card.dataset.springReady === "true") return;
    card.dataset.springReady = "true";

    const cardStyler = styler(card);
    let startX = 0;
    let startY = 0;

    const down = listen(card, "pointerdown").start(event => {
      if (event.button !== 0) return;
      event.preventDefault();
      startX = cardStyler.get("x") || 0;
      startY = cardStyler.get("y") || 0;

      const pointerMove = pointer(event).start(({ x, y }) => {
        cardStyler.set({
          x: startX + x - event.clientX,
          y: startY + y - event.clientY,
          scale: 1.025,
          zIndex: 5
        });
      });

      const pointerUp = listen(window, "pointerup").start(() => {
        pointerMove.stop();
        pointerUp.stop();

        spring({
          from: { x: cardStyler.get("x") || 0, y: cardStyler.get("y") || 0, scale: 1.025 },
          to: { x: 0, y: 0, scale: 1 },
          stiffness: 260,
          damping: 20,
          mass: 1
        }).start(value => cardStyler.set(value));
        cardStyler.set("zIndex", 1);
      });
    });

    card.addEventListener("dragstart", event => event.preventDefault());
    card.dataset.springSubscription = "active";
  });
}

document.addEventListener("currency-cards-rendered", enableSpringCards);
window.addEventListener("load", enableSpringCards);
