/**
 * Custom Gift Grid -- quick-view dialogs.
 *
 * No dependencies and no theme JS. Every dialog is already in the DOM,
 * rendered by the section, so this only has to open it, keep the option
 * controls in sync with the product's variants, and submit the form.
 */
(() => {
  'use strict';

  /**
   * Resolves the selected option values to a variant and keeps the
   * dialog's price, hidden variant id and submit state in step with it.
   */
  class QuickView {
    constructor(dialog, bonus) {
      this.dialog = dialog;
      this.bonus = bonus || { variantId: null, values: [] };
      this.form = dialog.querySelector('[data-cgg-form]');
      this.price = dialog.querySelector('[data-cgg-price]');
      this.variantInput = dialog.querySelector('[data-cgg-variant-id]');
      this.submit = dialog.querySelector('[data-cgg-submit]');
      this.submitLabel = dialog.querySelector('[data-cgg-submit-label]');
      this.status = dialog.querySelector('[data-cgg-status]');
      this.optionGroups = Array.from(dialog.querySelectorAll('[data-cgg-option]'));
      this.variants = QuickView.readVariants(dialog);
      this.opener = null;
      this.busy = false;

      this.bindOptions();
      this.bindDismiss();
      this.bindSubmit();
      this.update();
    }

    static readVariants(dialog) {
      const script = dialog.querySelector('[data-cgg-variants]');

      if (!script) return [];

      try {
        const parsed = JSON.parse(script.textContent);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.warn('[custom-gift-grid] could not parse variant data', error);
        return [];
      }
    }

    /** Selected value for each option, in the product's option order. */
    get selectedOptions() {
      return this.optionGroups.map((group) => {
        const checked = group.querySelector('[role="radio"][aria-checked="true"]');
        if (checked) return checked.dataset.cggValue;

        const select = group.querySelector('[data-cgg-select]');
        return select ? select.value : null;
      });
    }

    /**
     * Positional match against variant.options. A variant id is never
     * derived from the option values -- only ever looked up this way.
     */
    get currentVariant() {
      const selected = this.selectedOptions;

      return (
        this.variants.find(
          (variant) =>
            variant.options.length === selected.length &&
            variant.options.every((value, index) => value === selected[index])
        ) || null
      );
    }

    bindOptions() {
      this.optionGroups.forEach((group) => {
        const swatches = Array.from(group.querySelectorAll('[role="radio"]'));

        swatches.forEach((swatch, index) => {
          swatch.addEventListener('click', () => {
            this.select(swatches, index);
          });

          // Roving focus, so a radiogroup behaves like a radiogroup.
          swatch.addEventListener('keydown', (event) => {
            const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
            if (!step) return;

            event.preventDefault();
            const next = (index + step + swatches.length) % swatches.length;
            this.select(swatches, next);
            swatches[next].focus();
          });
        });

        const select = group.querySelector('[data-cgg-select]');
        if (select) select.addEventListener('change', () => this.update());
      });
    }

    select(swatches, index) {
      swatches.forEach((swatch, i) => {
        swatch.setAttribute('aria-checked', String(i === index));
        swatch.tabIndex = i === index ? 0 : -1;
      });

      this.update();
    }

    bindDismiss() {
      this.dialog.querySelectorAll('[data-cgg-close]').forEach((button) => {
        button.addEventListener('click', () => this.close());
      });

      // Clicks on ::backdrop land on the dialog element itself.
      this.dialog.addEventListener('click', (event) => {
        if (event.target === this.dialog) this.close();
      });

      this.dialog.addEventListener('close', () => {
        this.setStatus('');
        if (this.opener && document.contains(this.opener)) this.opener.focus();
        this.opener = null;
      });
    }

    open(opener) {
      this.opener = opener || null;
      this.update();

      if (typeof this.dialog.showModal === 'function') {
        this.dialog.showModal();
      } else {
        // No <dialog> support: the form still posts to /cart/add on its own.
        this.dialog.setAttribute('open', '');
      }
    }

    close() {
      if (typeof this.dialog.close === 'function') {
        this.dialog.close();
      } else {
        this.dialog.removeAttribute('open');
      }
    }

    /**
     * The form's own action is /cart/add, which is the no-JS fallback.
     * Its .js sibling is the AJAX endpoint, and reading it off the form
     * keeps whatever locale prefix Liquid put there.
     */
    get cartAddUrl() {
      return `${this.form.getAttribute('action')}.js`;
    }

    bindSubmit() {
      if (!this.form) return;

      this.form.addEventListener('submit', (event) => {
        // Without fetch, let the browser post the form the old way.
        if (typeof window.fetch !== 'function') return;

        event.preventDefault();
        this.addToCart();
      });
    }

    /**
     * Everything goes up in a single items[] request. Adding line items
     * one call at a time can half-fail and leave the cart inconsistent.
     */
    async addToCart() {
      const variant = this.currentVariant;
      if (this.busy || !variant || !variant.available) return;

      this.busy = true;
      this.setBusy(true);
      this.setStatus('');

      try {
        const response = await fetch(this.cartAddUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items: this.buildItems(variant) }),
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            (payload && (payload.description || payload.message)) || 'Could not add to cart.'
          );
        }

        // Lets anything else on the page refresh without coupling to it.
        document.dispatchEvent(
          new CustomEvent('cart:updated', {
            bubbles: true,
            detail: { items: payload ? payload.items : null },
          })
        );

        this.setStatus('Added to cart.', 'success');
        window.setTimeout(() => this.close(), 1200);
      } catch (error) {
        this.setStatus(error.message || 'Could not add to cart.', 'error');
      } finally {
        this.busy = false;
        this.setBusy(false);
      }
    }

    /** The line items this add should create. */
    buildItems(variant) {
      const items = [{ id: variant.id, quantity: 1 }];

      if (this.shouldAddBonus(variant)) {
        items.push({ id: this.bonus.variantId, quantity: 1 });
      }

      return items;
    }

    /**
     * True when the chosen variant carries every trigger value, so the
     * bonus product rides along in the same request.
     */
    shouldAddBonus(variant) {
      const { variantId, values } = this.bonus;

      if (!variantId || values.length === 0) return false;

      // Never let the bonus product trigger a second copy of itself.
      if (variantId === variant.id) return false;

      const chosen = variant.options.map((value) => String(value).trim().toLowerCase());

      return values.every((value) => chosen.includes(value));
    }

    setBusy(busy) {
      if (busy) {
        if (this.submit) this.submit.disabled = true;
        if (this.submitLabel) this.submitLabel.textContent = 'Adding...';
        return;
      }

      // Restores the label and disabled state from the resolved variant.
      this.update();
    }

    /** Reflects the resolved variant into the dialog. */
    update() {
      const variant = this.currentVariant;

      if (this.variantInput) this.variantInput.value = variant ? variant.id : '';
      if (this.price && variant) this.price.textContent = variant.price;

      const sellable = Boolean(variant && variant.available);

      if (this.submit) this.submit.disabled = !sellable;

      if (this.submitLabel) {
        if (!variant) {
          this.submitLabel.textContent = 'Unavailable';
        } else if (!variant.available) {
          this.submitLabel.textContent = 'Sold out';
        } else {
          this.submitLabel.textContent = 'Add to cart';
        }
      }

      this.markUnavailable();
    }

    /**
     * Marks swatch values that cannot be bought alongside the other
     * options as they currently stand. They stay selectable -- choosing
     * one is how a shopper finds out it is gone.
     */
    markUnavailable() {
      const selected = this.selectedOptions;

      this.optionGroups.forEach((group, position) => {
        group.querySelectorAll('[role="radio"]').forEach((swatch) => {
          const candidate = selected.slice();
          candidate[position] = swatch.dataset.cggValue;

          const reachable = this.variants.some(
            (variant) =>
              variant.available &&
              variant.options.every((value, index) => value === candidate[index])
          );

          swatch.dataset.cggUnavailable = String(!reachable);
        });
      });
    }

    setStatus(message, state) {
      if (!this.status) return;

      this.status.textContent = message;

      if (state) {
        this.status.dataset.state = state;
      } else {
        delete this.status.dataset.state;
      }
    }
  }

  /** Wires every dialog in one section and delegates the hotspot clicks. */
  function initSection(section) {
    if (section.dataset.cggReady === 'true') return;
    section.dataset.cggReady = 'true';

    const views = new Map();

    // Section level, so all six dialogs share one rule.
    const bonus = {
      variantId: Number(section.dataset.cggBonusVariant) || null,
      values: (section.dataset.cggBonusValues || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    };

    section.querySelectorAll('[data-cgg-dialog]').forEach((dialog) => {
      views.set(dialog.dataset.cggDialog, new QuickView(dialog, bonus));
    });

    section.addEventListener('click', (event) => {
      const opener = event.target.closest('[data-cgg-open]');
      if (!opener || !section.contains(opener)) return;

      const view = views.get(opener.dataset.cggOpen);
      if (!view) return;

      event.preventDefault();
      view.open(opener);
    });
  }

  function init(root) {
    (root || document).querySelectorAll('.custom-gift-grid').forEach(initSection);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }

  // Theme editor re-renders a section's markup on every change.
  document.addEventListener('shopify:section:load', (event) => init(event.target));
})();
