// The clip plays normally; the streaming and Inspector graphics illustrate its annotated intervals.
function createStreamSimulation(root) {
  const media = root.querySelector('#simulation-video');
  const scene = media.closest('.player-scene');
  const loader = root.querySelector('.simulation-loading');
  const startButton = root.querySelector('#simulation-start');
  const cells = [...root.querySelectorAll('[data-segment]')];
  const verdicts = cells.map(cell => cell.querySelector('.segment-verdict'));
  const clipDuration = Number(media.dataset.duration);
  const segmentDuration = 3;
  const manipulationStart = 13;
  const segments = cells.map((_, index) => ({ start: index * segmentDuration, end: Math.min((index + 1) * segmentDuration, clipDuration) }));
  const timeline = root.querySelector('.segment-timeline');
  const playhead = root.querySelector('.timeline-playhead');
  const packet = root.querySelector('.network-packet');
  const request = root.querySelector('.network-request');
  const route = root.querySelector('.network-route');
  const frames = root.querySelector('.sample-frames');
  const frameRoute = root.querySelector('.frame-transfer');
  const processor = root.querySelector('.dove-analysis');
  const resultToken = root.querySelector('.result-transfer');
  const localZone = root.querySelector('.local-zone');
  const resultConnector = root.querySelector('.result-connector');
  const resultPath = resultConnector.querySelector('path');
  const analysisStatus = root.querySelector('#analysis-status');
  const inspectorFrame = root.querySelector('#inspector-frame');
  const analysisReturn = root.querySelector('#analysis-return');
  const playbackStatus = root.querySelector('#playback-status');
  const position = root.querySelector('#simulation-position');
  const downloadStatus = root.querySelector('#download-status');
  const warning = root.querySelector('#simulation-warning');
  const warningSegments = root.querySelector('#simulation-warning-segments');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const playbackStart = 2;
  const loopEndPause = 3;
  const snapshots = [4, 9, 14];
  const staticPlayback = [0, 6, 9];
  const arrivalTime = index => 0.95 + index * 1.15;
  const downloadEnd = arrivalTime(cells.length - 1) + 1;
  // Buffered segments wait for an independent Inspector queue. Processing times
  // vary so downloads can continue while an earlier segment is still analysed.
  const analysisDurations = [0.95, 0.7, 1.1, 0.8, 1.0, 0.65, 0.95, 0.75];
  const analysisSchedule = [];
  segments.forEach((_, index) => {
    const previousEnd = index === 0 ? 0 : analysisSchedule[index - 1].end;
    const start = Math.max(arrivalTime(index) + 0.35, previousEnd + (index % 2 === 0 ? 0.38 : 0.22));
    analysisSchedule.push({ start, end: start + analysisDurations[index] });
  });
  const number = index => String(index + 1).padStart(2, '0');
  // A segment is highlighted if any of it overlaps the known manipulated interval.
  // Segment 05 straddles the transition: 12–13 s original, 13–15 s manipulated.
  const isWarning = index => segments[index].end > manipulationStart;
  const imageSource = index => `assets/183-segments/segment-${number(index)}.jpg`;
  const formatTime = seconds => {
    const tenths = Math.floor(Math.max(0, seconds) * 10);
    return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
  };
  let stage = -1;
  let elapsed = 0;
  let holdElapsed = 0;
  let holding = false;
  let inView = false;
  let previousTime = null;
  let animation = null;
  let geometry = null;
  let resultPathIndex = -1;
  let generation = 0;
  let pendingPlay = false;
  let playbackBlocked = false;
  let staticFrame = null;

  media.muted = true;
  media.defaultMuted = true;
  const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const setImage = (image, index) => {
    const source = imageSource(index);
    if (image.getAttribute('src') !== source) image.setAttribute('src', source);
  };

  function routePoints(path, container) {
    const bounds = container.getBoundingClientRect();
    const matrix = path.getScreenCTM();
    const length = path.getTotalLength();
    return Array.from({ length: 41 }, (_, index) => {
      const point = path.getPointAtLength(length * index / 40).matrixTransform(matrix);
      return { x: point.x - bounds.left, y: point.y - bounds.top };
    });
  }
  function routePosition(points, progress) {
    const distance = Math.max(0, Math.min(1, progress)) * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(distance));
    const fraction = distance - index;
    return { x: points[index].x + (points[index + 1].x - points[index].x) * fraction, y: points[index].y + (points[index + 1].y - points[index].y) * fraction };
  }

  function measure() {
    const bounds = localZone.getBoundingClientRect();
    const processorBounds = processor.getBoundingClientRect();
    const timelineBounds = timeline.getBoundingClientRect();
    geometry = {
      width: timeline.clientWidth,
      cells: cells.map(cell => {
        const rect = cell.getBoundingClientRect();
        const style = getComputedStyle(cell);
        const borderLeft = parseFloat(style.borderLeftWidth);
        const borderRight = parseFloat(style.borderRightWidth);
        const left = rect.left - timelineBounds.left;
        return { left, width: rect.width, fillLeft: left + borderLeft, fillWidth: rect.width - borderLeft - borderRight };
      }),
      framePoints: routePoints(frameRoute.querySelector('path'), frameRoute),
      packetPoints: routePoints([...route.querySelectorAll('.response-path')].find(path => getComputedStyle(path).display !== 'none'), route),
      requestPoints: routePoints([...route.querySelectorAll('.request-path')].find(path => getComputedStyle(path).display !== 'none'), route),
      packetSize: { width: packet.offsetWidth, height: packet.offsetHeight },
      requestSize: { width: request.offsetWidth, height: request.offsetHeight },
      frameSize: { width: frames.offsetWidth, height: frames.offsetHeight },
      resultStart: { x: processorBounds.left + processorBounds.width / 2 - bounds.left, y: processorBounds.bottom - bounds.top },
      resultTargets: cells.map(cell => { const rect = cell.getBoundingClientRect(); return { x: rect.right - bounds.left - 7, y: rect.top - bounds.top }; })
    };
    resultConnector.setAttribute('viewBox', `0 0 ${localZone.clientWidth} ${localZone.clientHeight}`);
    resultPathIndex = -1;
    render();
  }

  function resetCycle() {
    generation += 1;
    pendingPlay = false;
    playbackBlocked = false;
    holding = false;
    holdElapsed = 0;
    elapsed = 0;
    staticFrame = null;
    startButton.hidden = true;
    media.pause();
    if (media.readyState >= 1) media.currentTime = 0;
  }

  function applyStaticFrame() {
    if (stage < 0 || media.readyState < 1) return;
    media.pause();
    const target = stage === 0 ? 0 : staticPlayback[stage];
    if (staticFrame !== target) {
      staticFrame = target;
      media.currentTime = target;
    }
  }

  function tryPlayback() {
    if (stage <= 0 || !inView || document.hidden || motionPreference.matches || elapsed < playbackStart || holding || media.ended || pendingPlay || playbackBlocked || !media.paused) return;
    const attempt = generation;
    pendingPlay = true;
    media.muted = true;
    media.playbackRate = 1;
    const promise = media.play();
    promise.then(() => {
      if (attempt !== generation) return;
      startButton.hidden = true;
      if (!inView || document.hidden || motionPreference.matches || stage === 0) media.pause();
    }).catch(() => {
      if (attempt !== generation || !inView || document.hidden || motionPreference.matches) return;
      playbackBlocked = true;
      startButton.hidden = false;
    }).finally(() => { if (attempt === generation) pendingPlay = false; });
  }

  function render() {
    if (stage < 0 || !geometry) return;
    if (motionPreference.matches || stage === 0) applyStaticFrame();
    const time = motionPreference.matches ? snapshots[stage] : stage === 0 ? Math.min(elapsed, downloadEnd) : elapsed;
    const downloaded = cells.filter((_, index) => time >= arrivalTime(index)).length;
    const loading = downloaded === 0 || media.readyState < 2;
    scene.classList.toggle('is-loading', loading);
    loader.hidden = !loading;
    // The media element is the playback clock, including pauses, stalls, and the final short segment.
    const playback = stage === 0 ? 0 : Math.min(clipDuration, Math.max(0, media.currentTime));
    const complete = stage > 0 && (media.ended || playback >= clipDuration - 0.015);
    const playingIndex = Math.min(cells.length - 1, Math.floor(playback / segmentDuration));
    const segment = segments[playingIndex];
    const fraction = Math.max(0, Math.min(1, (playback - segment.start) / (segment.end - segment.start)));
    const current = geometry.cells[playingIndex];
    // Move continuously through cell gaps, then use this same pixel coordinate
    // for both the playhead and each cell's played fill (including its borders).
    const left = playingIndex === 0 ? 0 : (geometry.cells[playingIndex - 1].left + geometry.cells[playingIndex - 1].width + current.left) / 2;
    const right = playingIndex === cells.length - 1 ? geometry.width : (current.left + current.width + geometry.cells[playingIndex + 1].left) / 2;
    const pixel = complete ? geometry.width : left + fraction * (right - left);
    let analysing = -1;
    let analysisAge = 0;
    let analysisDuration = 0;
    let latestResult = -1;

    cells.forEach((cell, index) => {
      const available = index < downloaded;
      const segment = segments[index];
      const progress = complete ? 1 : Math.max(0, Math.min(1, (playback - segment.start) / (segment.end - segment.start)));
      const cellGeometry = geometry.cells[index];
      const watched = available ? Math.max(0, Math.min(1, (pixel - cellGeometry.fillLeft) / cellGeometry.fillWidth)) : 0;
      const job = analysisSchedule[index];
      const age = time - job.start;
      const completed = stage === 2 && available && time >= job.end;
      const processing = stage === 2 && available && age >= 0 && time < job.end;
      const state = !available ? 'upcoming' : progress >= 1 ? 'played' : stage > 0 && playback > 0 && index === playingIndex && !complete ? 'playing' : 'buffered';
      const verdict = completed ? (isWarning(index) ? 'is-warning' : 'is-clear') : '';
      const classes = `timeline-segment ${state}${verdict ? ` ${verdict}` : ''}${processing ? ' is-analysing' : ''}`;
      if (cell.className !== classes) cell.className = classes;
      const fill = String(watched);
      if (cell.style.getPropertyValue('--watched-scale') !== fill) cell.style.setProperty('--watched-scale', fill);
      const color = state === 'playing' && watched < 0.5 ? (completed && isWarning(index) ? '#923e23' : '#315d95') : '';
      if (cell.style.color !== color) cell.style.color = color;
      text(verdicts[index], completed ? (isWarning(index) ? '!' : '✓') : '');
      const description = `Segment ${number(index)}, ${segment.start}–${segment.end} seconds: ${state === 'upcoming' ? 'not downloaded' : state}${completed ? (isWarning(index) ? ', potential deepfake' : ', no manipulation detected') : ''}`;
      if (cell.getAttribute('aria-label') !== description) cell.setAttribute('aria-label', description);
      if (processing) { analysing = index; analysisAge = age; analysisDuration = job.end - job.start; }
      if (completed) latestResult = index;
    });

    inspectorFrame.parentElement.classList.toggle('is-analysing', analysing >= 0);
    if (analysing >= 0) setImage(inspectorFrame, analysing);
    const flagged = stage === 2 ? cells.map((_, index) => index).filter(index => isWarning(index) && time >= analysisSchedule[index].end) : [];
    warning.hidden = flagged.length === 0;
    text(warningSegments, flagged.length === 0 ? '' : flagged.length === 1 ? `Segment ${number(flagged[0])}` : `Segments ${number(flagged[0])}–${number(flagged[flagged.length - 1])}`);
    playhead.style.transform = `translateX(${pixel}px)`;
    playhead.style.opacity = playback > 0 ? '1' : '0';
    text(playbackStatus, complete ? 'Playback complete' : playback > 0 ? `Segment ${number(playingIndex)}` : downloaded ? 'Buffered' : 'Waiting');
    text(position, loading ? 'BUFFERING' : stage === 0 ? 'READY TO PLAY' : `${formatTime(playback)} / ${formatTime(clipDuration)}`);
    text(downloadStatus, `${downloaded} / ${cells.length} downloaded`);

    const requesting = cells.findIndex((_, index) => time >= arrivalTime(index) - 0.85 && time < arrivalTime(index) - 0.55);
    request.style.opacity = requesting >= 0 && !motionPreference.matches ? '1' : '0';
    if (requesting >= 0) {
      const flight = (time - arrivalTime(requesting) + 0.85) / 0.3;
      const point = routePosition(geometry.requestPoints, flight);
      request.style.setProperty('--request-x', `${point.x - geometry.requestSize.width / 2}px`);
      request.style.setProperty('--request-y', `${point.y - geometry.requestSize.height / 2}px`);
      text(request.querySelector('span'), number(requesting));
    }
    const incoming = cells.findIndex((_, index) => time < arrivalTime(index) && time >= arrivalTime(index) - 0.45);
    packet.style.opacity = incoming >= 0 && !motionPreference.matches ? '1' : '0';
    if (incoming >= 0) {
      const point = routePosition(geometry.packetPoints, (time - arrivalTime(incoming) + 0.45) / 0.45);
      packet.style.setProperty('--packet-x', `${point.x - geometry.packetSize.width / 2}px`);
      packet.style.setProperty('--packet-y', `${point.y - geometry.packetSize.height / 2}px`);
      setImage(packet.querySelector('img'), incoming);
      text(packet.querySelector('span'), number(incoming));
    }

    frames.style.opacity = '0';
    resultToken.style.opacity = '0';
    resultConnector.style.opacity = '0';
    processor.style.setProperty('--compute-progress', '0%');
    if (stage !== 2) {
      text(analysisStatus, 'Waiting for frames');
      text(analysisReturn, 'Timeline results');
      analysisReturn.className = 'analysis-return';
    } else if (analysing >= 0) {
      text(analysisStatus, `Analysing · ${number(analysing)}`);
      const resultStart = analysisDuration - 0.22;
      processor.style.setProperty('--compute-progress', `${Math.max(0, Math.min(1, (analysisAge - 0.3) / (resultStart - 0.3))) * 100}%`);
      if (analysisAge < 0.3 && !motionPreference.matches) {
        frames.style.opacity = '1';
        const point = routePosition(geometry.framePoints, analysisAge / 0.3);
        frames.style.setProperty('--frame-x', `${point.x - geometry.frameSize.width / 2}px`);
        frames.style.setProperty('--frame-y', `${point.y - geometry.frameSize.height / 2}px`);
        frames.querySelectorAll('img').forEach(image => setImage(image, analysing));
      }
      if (analysisAge >= resultStart && !motionPreference.matches) {
        const start = geometry.resultStart;
        const end = geometry.resultTargets[analysing];
        if (resultPathIndex !== analysing) {
          resultPath.setAttribute('d', `M${start.x},${start.y} C${start.x},${start.y + 20} ${end.x},${end.y - 22} ${end.x},${end.y}`);
          resultPathIndex = analysing;
        }
        resultConnector.style.opacity = '1';
        const point = resultPath.getPointAtLength(resultPath.getTotalLength() * Math.min(1, (analysisAge - resultStart) / 0.22));
        resultToken.style.opacity = '1';
        resultToken.style.transform = `translate(${point.x - 7}px, ${point.y - 7}px)`;
        resultToken.classList.toggle('is-warning', isWarning(analysing));
        text(resultToken, isWarning(analysing) ? '!' : '✓');
      }
    } else {
      text(analysisStatus, 'Waiting for frames');
      processor.style.setProperty('--compute-progress', latestResult === cells.length - 1 ? '100%' : '0%');
    }
    if (stage === 2) {
      if (latestResult === cells.length - 1) {
        if (!analysisReturn.classList.contains('analysis-summary')) {
          const groups = [];
          segments.forEach((_, index) => {
            const warning = isWarning(index);
            const last = groups[groups.length - 1];
            if (last && last.warning === warning) last.end = index + 1;
            else groups.push({ start: index + 1, end: index + 1, warning });
          });
          const detectedGroups = groups.filter(group => group.warning);
          const summary = [];
          detectedGroups.forEach(group => {
            const detection = document.createElement('span');
            detection.className = 'is-warning';
            detection.textContent = `Potential deepfake detected in ${group.start === group.end ? 'segment' : 'segments'} ${group.start}${group.start === group.end ? '' : `–${group.end}`}.`;
            const location = document.createElement('span');
            location.className = 'summary-location';
            // Use the classified segments' boundaries, not the clip's annotated
            // 13-second transition: localization is approximate at segment level.
            const interval = document.createElement('span');
            interval.className = 'summary-range';
            interval.textContent = `${segments[group.start - 1].start}–${segments[group.end - 1].end} s.`;
            location.append('Approx. temporal location: ', interval);
            summary.push(detection, location);
          });
          if (summary.length === 0) {
            const clear = document.createElement('span');
            clear.className = 'is-clear';
            clear.textContent = 'No potential deepfake detected in the analysed segments.';
            summary.push(clear);
          }
          analysisReturn.replaceChildren(...summary);
          analysisReturn.className = 'analysis-return analysis-summary';
        }
      } else {
        text(analysisReturn, latestResult < 0 ? 'Timeline results' : `${isWarning(latestResult) ? '!' : '✓'} ${number(latestResult)} · ${isWarning(latestResult) ? 'potential deepfake' : 'no manipulation detected'}`);
        analysisReturn.className = `analysis-return${latestResult >= 0 ? (isWarning(latestResult) ? ' is-warning' : ' is-clear') : ''}`;
      }
    }
  }

  function tick(now) {
    animation = null;
    if (motionPreference.matches) { applyStaticFrame(); render(); previousTime = null; return; }
    if (!inView || document.hidden) { media.pause(); previousTime = null; return; }
    const delta = previousTime === null ? 0 : Math.min(0.1, (now - previousTime) / 1000);
    previousTime = now;
    elapsed += delta;
    if (stage === 0) {
      if (elapsed >= downloadEnd + loopEndPause) resetCycle();
    } else {
      if (media.ended && !holding) { holding = true; holdElapsed = 0; }
      if (holding) {
        holdElapsed += delta;
        if (holdElapsed >= loopEndPause) resetCycle();
      } else tryPlayback();
    }
    render();
    animation = requestAnimationFrame(tick);
  }
  function start() {
    if (animation === null && inView && !document.hidden && !motionPreference.matches) {
      previousTime = null;
      animation = requestAnimationFrame(tick);
    }
  }
  startButton.addEventListener('click', () => { playbackBlocked = false; tryPlayback(); });
  media.addEventListener('loadedmetadata', () => { staticFrame = null; if (motionPreference.matches || stage === 0) applyStaticFrame(); render(); });
  media.addEventListener('seeked', render);
  media.addEventListener('loadeddata', render);
  media.addEventListener('timeupdate', render);
  media.addEventListener('ended', () => { if (media.ended && stage > 0) { holding = true; holdElapsed = 0; render(); } });
  new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    if (!inView) media.pause();
    start();
  }, { threshold: 0 }).observe(root);
  new ResizeObserver(measure).observe(root);
  document.addEventListener('visibilitychange', () => { if (document.hidden) media.pause(); else start(); });
  motionPreference.addEventListener('change', () => {
    generation += 1;
    pendingPlay = false;
    staticFrame = null;
    if (motionPreference.matches) applyStaticFrame();
    render();
    start();
  });
  return {
    setStage(nextStage) {
      if (nextStage === stage) return;
      stage = nextStage;
      resetCycle();
      previousTime = null;
      render();
      start();
    }
  };
}

const visual = document.querySelector('.story-visual');
const captions = [...document.querySelectorAll('[data-caption]')];
const stageButtons = [...document.querySelectorAll('[data-go-step]')];
const header = document.querySelector('.header-shell');
const simulation = createStreamSimulation(visual);
const navigationLinks = [...document.querySelectorAll('.header nav a')];
const navigationSections = navigationLinks.map(link => document.querySelector(link.getAttribute('href')));
let scheduled = false;

function updateNavigation() {
  const readingLine = header.offsetHeight + Math.min(180, (window.innerHeight - header.offsetHeight) * 0.3);
  let activeIndex = 0;
  navigationSections.forEach((section, index) => {
    if (section.getBoundingClientRect().top <= readingLine) activeIndex = index;
  });
  if (Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2) {
    activeIndex = navigationSections.length - 1;
  }
  navigationLinks.forEach((link, index) => {
    if (index === activeIndex) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

// The visitor selects the stage; scrolling never changes or restarts it.
function selectStoryStep(activeIndex) {
  visual.dataset.stage = String(activeIndex);
  simulation.setStage(activeIndex);
  captions.forEach((caption, index) => {
    caption.classList.toggle('is-active', index === activeIndex);
    caption.setAttribute('aria-hidden', String(index !== activeIndex));
  });
  stageButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === activeIndex)));
}
function updatePage() {
  scheduled = false;
  updateNavigation();
}
function scheduleUpdate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(updatePage);
}

stageButtons.forEach((button, index) => {
  button.addEventListener('click', () => selectStoryStep(index));
  button.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % stageButtons.length;
    else if (event.key === 'ArrowLeft') next = (index + stageButtons.length - 1) % stageButtons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = stageButtons.length - 1;
    else return;
    event.preventDefault();
    stageButtons[next].focus({ preventScroll: true });
    selectStoryStep(next);
  });
});
window.addEventListener('scroll', scheduleUpdate, { passive: true });
window.addEventListener('resize', scheduleUpdate);
window.addEventListener('load', scheduleUpdate);
if (document.fonts) document.fonts.ready.then(scheduleUpdate);
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
  scheduleUpdate();
}).observe(header);
selectStoryStep(0);
updatePage();
