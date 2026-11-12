(() => {
  const filter = document.querySelector('[data-model-filter]');
  if (filter) {
    filter.hidden = false;
    filter.querySelector('select').addEventListener('change', event => {
      const family = event.target.value;
      const rows = [...document.querySelectorAll('[data-model-row]')];
      rows.forEach(row => { row.hidden = family !== 'all' && row.dataset.family !== family; });
      filter.querySelector('[data-model-count]').textContent = `${rows.filter(row => !row.hidden).length} models`;
    });
  }
  const calculator = document.querySelector('[data-model-estimator]');
  if (calculator) {
    const fields = calculator.querySelector('.model-estimator-fields');
    fields.hidden = false;
    const output = fields.querySelector('output');
    const update = () => {
      const usage = {};
      for (const name of ['input', 'cached', 'output', 'write', 'writeHour']) {
        const input = fields.querySelector(`input[name="${name}"]`);
        if (!input) { usage[name] = 0; continue; }
        if (!input.value.trim() || !input.validity.valid || !Number.isFinite(input.valueAsNumber)) {
          output.textContent = 'Enter whole, non-negative token counts.';
          return;
        }
        usage[name] = input.valueAsNumber;
      }
      const tiers = JSON.parse(calculator.dataset.rateTiers);
      const long = tiers.length > 1 && usage.input + usage.cached + usage.write + usage.writeHour > Number(calculator.dataset.threshold);
      const rate = tiers[long ? 1 : 0];
      const cost = Object.entries(usage).reduce((sum, [name, tokens]) => sum + tokens * rate[name] / 1000000, 0);
      output.textContent = `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(cost)} Credits before per-request rounding${tiers.length > 1 ? (long ? ' · Long-context rate' : ' · Standard-context rate') : ''}`;
    };
    fields.addEventListener('input', update);
    update();
  }
})();
