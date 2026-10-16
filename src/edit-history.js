export function createEditHistory(subtitles = [], limit = 50) {
  return {
    past: [],
    present: cloneSubtitles(subtitles),
    future: [],
    limit: Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 50,
  };
}

export function commitEdit(history, subtitles) {
  if (sameSubtitles(history.present, subtitles)) {
    return cloneHistory(history);
  }

  const past = [...history.past, history.present];
  return cloneHistory({
    ...history,
    past: history.limit > 0 ? past.slice(-history.limit) : [],
    present: subtitles,
    future: [],
  });
}

export function undoEdit(history) {
  if (history.past.length === 0) {
    return cloneHistory(history);
  }

  return cloneHistory({
    ...history,
    past: history.past.slice(0, -1),
    present: history.past.at(-1),
    future: [history.present, ...history.future],
  });
}

export function redoEdit(history) {
  if (history.future.length === 0) {
    return cloneHistory(history);
  }

  return cloneHistory({
    ...history,
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  });
}

function cloneSubtitles(subtitles) {
  return subtitles.map((subtitle) => ({ ...subtitle }));
}

function cloneHistory(history) {
  return {
    ...history,
    past: history.past.map(cloneSubtitles),
    present: cloneSubtitles(history.present),
    future: history.future.map(cloneSubtitles),
  };
}

function sameSubtitles(first, second) {
  return first.length === second.length && first.every((subtitle, index) => {
    const other = second[index];
    const keys = Object.keys(subtitle);
    return keys.length === Object.keys(other).length
      && keys.every((key) => Object.hasOwn(other, key) && Object.is(subtitle[key], other[key]));
  });
}
