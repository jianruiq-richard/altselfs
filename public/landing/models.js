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
      let cost = 0;
      for (const name of ['input', 'cached', 'output']) {
        const input = fields.querySelector(`input[name="${name}"]`);
        if (!input.value.trim() || !input.validity.valid || !Number.isFinite(input.valueAsNumber)) {
          output.textContent = 'Enter whole, non-negative token counts.';
          return;
        }
        cost += input.valueAsNumber * Number(calculator.dataset[name]) / 1000000;
      }
      output.textContent = `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(cost)} Credits before turn-level rounding`;
    };
    fields.addEventListener('input', update);
    update();
  }
})();
