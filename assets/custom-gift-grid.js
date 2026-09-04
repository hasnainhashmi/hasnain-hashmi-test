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
    constructor(dialog) {
      this.dialog = dialog;
      this.form = dialog.querySelector('[data-cgg-form]');
      this.price = dialog.querySelector('[data-cgg-price]');
      this.variantInput = dialog.querySelector('[data-cgg-variant-id]');
      this.submit = dialog.querySelector('[data-cgg-submit]');
      this.submitLabel = dialog.querySelector('[data-cgg-submit-label]');
      this.status = dialog.querySelector('[data-cgg-status]');
      this.optionGroups = Array.from(dialog.querySelectorAll('[data-cgg-option]'));
      this.variants = QuickView.readVariants(dialog);
      this.opener = null;

      this.bindOptions();
      this.bindDismiss();
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

    section.querySelectorAll('[data-cgg-dialog]').forEach((dialog) => {
      views.set(dialog.dataset.cggDialog, new QuickView(dialog));
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
