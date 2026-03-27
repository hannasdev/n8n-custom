const fs = require('fs');

const workflowPath = '/Users/hanna/n8n-my-custom-node/my-custom-node/workflows/printer-statistics.workflow.json';
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const normalize = workflow.nodes.find((n) => n.name === 'Normalize Stats Event');
if (!normalize) {
  throw new Error('Normalize Stats Event node not found');
}

normalize.parameters.jsCode = `function parseMessage(input) {
  if (typeof input?.message === 'string') {
    try {
      return JSON.parse(input.message);
    } catch (error) {
      return input;
    }
  }

  if (input?.message && typeof input.message === 'object') {
    return input.message;
  }

  return input;
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === 'number') {
    const millis = value > 1e12 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function dayKey(isoString) {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

const raw = parseMessage($json);
const eventTs = toIso(raw.timestamp ?? raw.event_ts);

return {
  event_ts: eventTs,
  day: dayKey(eventTs),
  printer_id: raw.printer_id ?? 'p1s_01',
  event_type: raw.inferred_event_type ?? raw.event_type ?? 'status_changed',
  transition_from: raw.old_state ?? '',
  transition_to: raw.new_state ?? '',
  progress_pct: Number(raw?.snapshot?.progress ?? 0),
  duration_sec: Number(raw.duration_sec ?? raw?.snapshot?.duration_sec ?? raw?.snapshot?.elapsed_time_s ?? 0),
  job_id: raw.job_id ?? raw?.snapshot?.job_id ?? raw?.snapshot?.task_name ?? raw.task_name ?? raw.event_id ?? '',
  raw_payload: JSON.stringify(raw)
};`;

const insertNode = workflow.nodes.find((n) => n.name === 'Insert Event Row');
if (insertNode && typeof insertNode.notes === 'string') {
  insertNode.notes = 'Requires a Data Table named printer_events with columns: event_ts(date), day(string), printer_id(string), event_type(string), transition_from(string), transition_to(string), progress_pct(number), duration_sec(number), job_id(string), raw_payload(string).';
}

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log('updated normalize node');
