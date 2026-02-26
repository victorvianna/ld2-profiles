let currentData = null;
let colorMapper = null;

const chart = flamegraph()
                  .width(1200)
                  .cellHeight(18)
                  .transitionDuration(750)
                  .minFrameSize(5)
                  .transitionEase(d3.easeCubic)
                  .sort(true)
                  .title('')
                  // Root on top
                  .inverted(true);

function convertToD3Json(data, metric) {
  // Suboptimal queue implementation (fine, graph is not that big).
  const q = [data];
  const enqueued = new Set([data]);
  while (q.length) {
    const node = q.shift();
    node['value'] = node['cpu-cycles'];
    // node["instructions"] can be 0 here and that will be handled later.
    node['metricVal'] = node[metric] / node['instructions'];
    for (const child of node['children']) {
      if (!enqueued.has(child)) {
        q.push(child);
        enqueued.add(child);
      }
    }
  }
}

function applyThreshold(threshold) {
  if (!colorMapper) {
    return;
  }
  chart.setColorMapper(d => {
    if (!isFinite(d.data.metricVal)) {
      return '#cccccc';
    }
    if (d.data.metricVal < threshold) {
      return '#f1f3f5';
    }
    return colorMapper(d.data.metricVal);
  });
  chart.update();
}

function updateChart() {
  if (!currentData) {
    return;
  }

  const selectedMetric = document.getElementById('metric-select').value;
  convertToD3Json(currentData, selectedMetric);

  const rootNode = d3.hierarchy(currentData);
  const validMetrics = rootNode.descendants()
                           .map(d => d.data.metricVal)
                           .filter(v => isFinite(v))
                           .sort(d3.ascending);

  const maxRatio = d3.max(validMetrics) || 0;
  const p98Ratio = d3.quantile(validMetrics, 0.98) || maxRatio;

  document.getElementById('max-label').innerText =
      maxRatio ? maxRatio.toFixed(2) : '0';

  // Configure the slider based on the 98th percentile for better usability.
  const slider = document.getElementById('threshold');
  const thresholdVal = document.getElementById('threshold-val');
  slider.max = p98Ratio ? Math.ceil(p98Ratio * 1.5) : 100;
  slider.step = slider.max / 200;

  // Use the 98th percentile as the top of the color domain.
  colorMapper = d3.scaleSequential(d3.interpolateOranges)
                    .domain([0, p98Ratio || 1])
                    .clamp(true);

  applyThreshold(parseFloat(slider.value));

  d3.select('#chart').datum(currentData).call(chart);
}

async function loadData() {
  const file = document.getElementById('file-select').value;
  const response = await fetch(`./out_profiling_ld2/${file}.json`);

  if (!response.ok) {
    console.error(`HTTP error! status: ${response.status}`);
    return;
  }

  currentData = await response.json();
  window.data = currentData;
  updateChart();
}

(async () => {
  const slider = document.getElementById('threshold');
  const thresholdVal = document.getElementById('threshold-val');

  // Read threshold from URL hash (e.g., #threshold=1.50).
  const hashMatch = window.location.hash.match(/#threshold=([0-9.]+)/);
  if (hashMatch) {
    const parsedVal = parseFloat(hashMatch[1]);
    if (!isNaN(parsedVal)) {
      slider.value = parsedVal;
    }
  }
  thresholdVal.innerText = parseFloat(slider.value).toFixed(2);

  // Event listeners.
  document.getElementById('file-select').addEventListener('change', loadData);
  document.getElementById('metric-select')
      .addEventListener('change', updateChart);

  slider.addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    thresholdVal.innerText = val.toFixed(2);
    applyThreshold(val);

    // Update the URL hash to make it shareable.
    const newHash = '#threshold=' + val.toFixed(2);
    try {
      // Attempt to update without cluttering the back button history.
      window.history.replaceState(null, null, newHash);
    } catch (err) {
      // Fallback for strict file:// origins.
      window.location.hash = newHash;
    }
  });

  const detailsDiv = document.getElementById('details');
  d3.select('#chart').on('mouseover', e => {
    const node = d3.select(e.target).datum() ||
        (e.target.parentNode ? d3.select(e.target.parentNode).datum() : null);
    if (node && node.data && node.data.name) {
      const {name, value, metricVal, children, ...nodeCounters} = node.data;
      detailsDiv.innerHTML = `
        <div style="font-size: 0.9em; color: #666;">${node.data['name']}</div>
        <div style="font-size: 0.9em; color: #666;">
          ${JSON.stringify(nodeCounters)}
        </div>
        `;
    }
  });

  await loadData();
})();
