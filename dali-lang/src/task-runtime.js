'use strict';

function buildStubHostAdapter() {
  return Object.freeze({
    async mediaAnalyze(input) {
      const sourceUrl = String(input?.sourceUrl || '').trim();
      const provider = String(input?.provider || '').trim().toLowerCase();
      return {
        ok: true,
        engine: 'stub.media.analyze.v1',
        provider,
        sourceUrl,
        confidence: 0.91,
        bpmEstimate: 122,
        loudnessLUFS: -10.4,
        summary: 'Stub analysis completed in sandbox (no external calls).'
      };
    },
    async mediaTranscode(input) {
      const sourceUrl = String(input?.sourceUrl || '').trim();
      const profile = String(input?.profile || 'music').trim().toLowerCase();
      return {
        ok: true,
        engine: 'stub.media.transcode.v1',
        sourceUrl,
        profile,
        outputVirtualPath: `/virtual/transcode/${Date.now()}-${profile}.wav`,
        summary: 'Stub transcode planned in sandbox (no external calls).'
      };
    }
  });
}

function normalizeCaps(permissions) {
  const allow = Array.isArray(permissions?.allow)
    ? permissions.allow.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const deny = Array.isArray(permissions?.deny)
    ? permissions.deny.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
    : [];
  return { allow, deny };
}

function isAllowed(capability, permissions) {
  const cap = String(capability || '').trim().toLowerCase();
  const { allow, deny } = normalizeCaps(permissions);
  if (deny.includes(cap)) return false;
  return allow.includes(cap);
}

function summarizeTask(task, permissions) {
  const provider = String(task?.source?.provider?.value || '').trim().toLowerCase();
  const mode = String(task?.source?.mode?.value || '').trim().toLowerCase();
  const url = String(task?.source?.url?.value || '').trim();
  const requires = ['media.analyze'];
  if (mode === 'analyze_only' && provider === 'local') requires.push('media.transcode');
  const denied = requires.filter((cap) => !isAllowed(cap, permissions));
  return {
    name: String(task?.name || '').trim(),
    provider,
    mode,
    url,
    requires,
    denied,
    permitted: denied.length === 0
  };
}

async function executeTaskWithStub(taskPlan, task, hostAdapter) {
  const execution = {
    task: String(taskPlan?.name || ''),
    ok: true,
    actions: [],
    timestamp: new Date().toISOString()
  };
  const provider = String(taskPlan?.provider || '').trim().toLowerCase();
  const sourceUrl = String(taskPlan?.url || '').trim();
  const mode = String(taskPlan?.mode || '').trim().toLowerCase();
  const profile = String(task?.output?.profile?.value || 'music').trim().toLowerCase();

  if (taskPlan.requires.includes('media.analyze')) {
    const analysis = await hostAdapter.mediaAnalyze({ provider, sourceUrl, mode });
    execution.actions.push({ capability: 'media.analyze', result: analysis });
  }
  if (taskPlan.requires.includes('media.transcode')) {
    const transcode = await hostAdapter.mediaTranscode({ provider, sourceUrl, profile });
    execution.actions.push({ capability: 'media.transcode', result: transcode });
  }

  return execution;
}

async function runProgramTasks(ast, options = {}) {
  const dryRun = options.dryRun !== false;
  const executeStub = options.executeStub === true;
  if (!dryRun && !executeStub) {
    throw new Error('[DALI SECURITY] non-dry-run execution requires --execute-stub in foundation runtime');
  }
  const preset = Array.isArray(ast?.presets) ? ast.presets[0] : null;
  const permissions = preset?.permissions || { allow: [], deny: [] };
  const tasks = Array.isArray(preset?.tasks) ? preset.tasks : [];
  const plan = tasks.map((t) => summarizeTask(t, permissions));
  const blocked = plan.filter((p) => !p.permitted).length;
  const result = {
    ok: blocked === 0,
    dryRun,
    executeStub,
    presetName: String(preset?.name || ''),
    taskCount: tasks.length,
    blocked,
    permissions: normalizeCaps(permissions),
    plan,
    timestamp: new Date().toISOString()
  };
  if (dryRun || blocked > 0) return result;

  const hostAdapter = buildStubHostAdapter();
  const execution = [];
  const taskList = Array.isArray(tasks) ? tasks : [];
  // Execute tasks sequentially for deterministic sandbox behavior.
  for (let i = 0; i < taskList.length; i += 1) {
    const taskPlan = plan[i];
    if (!taskPlan || !taskPlan.permitted) continue;
    const exec = await executeTaskWithStub(taskPlan, taskList[i], hostAdapter);
    execution.push(exec);
  }
  return {
    ...result,
    execution
  };
}

module.exports = {
  runProgramTasks
};
