// Words on screen (Georgian, English) and spoken prompts (English, Russian, Georgian if the phone has a
// Georgian voice; iPhones currently do not).

const km = (m, unitM, unitKm) => (m < 950 ? `${Math.max(0, Math.round(m / 10) * 10)} ${unitM}` : `${(m / 1000).toFixed(1)} ${unitKm}`);

export const STR = {
  en: {
    appName: 'Survey Navigator',
    tagline: 'Turn-by-turn for street-coverage routes',
    openFile: 'Open route file (GPX)',
    openAnother: 'Open another route',
    start: 'Start navigation',
    continueNav: 'Continue',
    restart: 'Start this route again',
    restartConfirm: 'Start again from the beginning? Today\'s progress and missed list on this phone will be cleared.',
    preview: 'Check the turns',
    loading: 'Reading the route…',
    loadingMap: 'Loading the street map…',
    howTitle: 'How to use',
    how: [
      'Put the day\'s GPX file on this iPhone (AirDrop, WhatsApp or Telegram → Save to Files).',
      'Tap “Open route file” and pick it.',
      'Mount the phone, connect the charger, tap Start. Keep this page open while driving.',
    ],
    stats: (kmT, turns) => `${kmT} km · ${turns} instructions`,
    matched: (p) => `Matched to the street map: ${p}%`,
    notMatched: 'Outside the street map: arrows only, no street names',
    progress: (d, t, p) => `${d} / ${t} km · ${p}%`,
    missedSummary: (n, m) => (n ? `${n} missed ${n === 1 ? 'stretch' : 'stretches'} · ${m}` : 'Nothing missed so far'),
    dist: (m) => km(m, 'm', 'km'),
    kind: {
      left: 'Turn left', right: 'Turn right', 'slight-left': 'Bear left', 'slight-right': 'Bear right',
      'sharp-left': 'Sharp left', 'sharp-right': 'Sharp right', 'keep-left': 'Keep left', 'keep-right': 'Keep right',
      straight: 'Go straight on', uturn: 'Make a U-turn', arrive: 'End of the route', rejoin: 'Back onto the route',
      roundabout: (n) => `Roundabout: exit ${n}`,
    },
    uturnEnd: 'U-turn at the dead end',
    then: 'Then',
    waitingGps: 'Waiting for GPS…',
    offRoute: 'Off route: follow the orange line',
    toStart: 'Drive to the start of the route',
    toResume: 'Drive back to where you stopped',
    noWayBack: 'Head back to the route',
    done: 'Route complete',
    report: (d, n, m) => `${d} km driven. ${n ? `${n} missed ${n === 1 ? 'stretch' : 'stretches'} (${m}).` : 'Nothing missed.'}`,
    eta: (h, m) => (h ? `${h} h ${m} min left` : `${m} min left`),
    recenter: 'Re-centre',
    menu: 'Menu',
    close: 'Close',
    skipTurn: 'Skip to the next turn (street closed)',
    backTurn: 'Go back one turn',
    fromHere: 'Continue from where I am',
    showAll: 'Show the whole day on the map',
    voice: 'Voice',
    voiceOpts: { en: 'English voice', ru: 'Russian voice', ka: 'Georgian voice', beep: 'Beeps only', off: 'Silent' },
    language: 'Language',
    missedTitle: 'Missed stretches',
    missedNone: 'Nothing missed so far.',
    missedAt: (a, len) => `at ${a} km · ${len}`,
    shareMissed: 'Send missed stretches (GPX)',
    shareTrack: 'Send the driven track (GPX)',
    simulate: 'Practice drive (simulation)',
    simMiss: 'Miss the next turn',
    simMissShort: 'Miss a turn', simStopShort: 'Stop',
    simSpeed: 'Speed',
    stopSim: 'Stop practice',
    endNav: 'Stop navigation',
    skipped: (m) => `Skipped ${m}: on the missed list`,
    goBack: 'Go back',
    rejoined: 'Back on the route',
    jumped: (m) => `Moved on ${m}: on the missed list`,
    noPoints: 'This file has no route points in it.',
    readError: 'Could not read this file.',
    gpsDenied: 'Location is blocked for this page. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using the App, then reload.',
    gpsError: 'No GPS signal yet.',
    keepOn: 'Keep the screen on: Settings → Display & Brightness → Auto-Lock → Never.',
    offlineReady: 'Map saved for offline use around this route',
    previewTitle: 'Turns on this route',
    prev: 'Previous', next: 'Next', startHere: 'Start from this turn',
    of: (i, n) => `${i} of ${n}`,
    about: 'Street data © OpenStreetMap contributors. The route file stays on this phone.',
  },
  ka: {
    appName: 'Survey Navigator',
    tagline: 'ნავიგაცია ქუჩების სრული აღწერის მარშრუტებისთვის',
    openFile: 'მარშრუტის ფაილის გახსნა (GPX)',
    openAnother: 'სხვა მარშრუტის გახსნა',
    start: 'ნავიგაციის დაწყება',
    continueNav: 'გაგრძელება',
    restart: 'მარშრუტის თავიდან დაწყება',
    restartConfirm: 'დავიწყოთ თავიდან? ამ ტელეფონზე დღევანდელი პროგრესი და გამოტოვებულების სია წაიშლება.',
    preview: 'მოსახვევების შემოწმება',
    loading: 'მარშრუტი იკითხება…',
    loadingMap: 'ქუჩების რუკა იტვირთება…',
    howTitle: 'როგორ გამოვიყენოთ',
    how: [
      'დღის GPX ფაილი გადმოიტანეთ ამ iPhone-ზე (AirDrop, WhatsApp ან Telegram → Save to Files).',
      'დააჭირეთ „მარშრუტის ფაილის გახსნა“ და აირჩიეთ ფაილი.',
      'დაამაგრეთ ტელეფონი, შეაერთეთ დამტენი და დააჭირეთ დაწყებას. მგზავრობისას ეს გვერდი ღია დატოვეთ.',
    ],
    stats: (kmT, turns) => `${kmT} კმ · ${turns} მითითება`,
    matched: (p) => `ქუჩების რუკას ემთხვევა: ${p}%`,
    notMatched: 'ქუჩების რუკის გარეთაა: მხოლოდ ისრები, ქუჩების სახელების გარეშე',
    progress: (d, t, p) => `${d} / ${t} კმ · ${p}%`,
    missedSummary: (n, m) => (n ? `გამოტოვებული მონაკვეთები: ${n} · ${m}` : 'ჯერ არაფერი გამოტოვებულა'),
    dist: (m) => km(m, 'მ', 'კმ'),
    kind: {
      left: 'მოუხვიეთ მარცხნივ', right: 'მოუხვიეთ მარჯვნივ', 'slight-left': 'ოდნავ მარცხნივ', 'slight-right': 'ოდნავ მარჯვნივ',
      'sharp-left': 'მკვეთრად მარცხნივ', 'sharp-right': 'მკვეთრად მარჯვნივ', 'keep-left': 'დარჩით მარცხენა მხარეს',
      'keep-right': 'დარჩით მარჯვენა მხარეს', straight: 'გააგრძელეთ პირდაპირ', uturn: 'შემობრუნდით',
      arrive: 'მარშრუტის დასასრული', rejoin: 'დაბრუნდით მარშრუტზე',
      roundabout: (n) => `წრიული მოძრაობა: ${n === 1 ? '1-ლი' : `მე-${n}`} გასასვლელი`,
    },
    uturnEnd: 'ჩიხის ბოლოს შემობრუნდით',
    then: 'შემდეგ',
    waitingGps: 'GPS-ის მოლოდინი…',
    offRoute: 'მიჰყევით ნარინჯისფერ ხაზს',
    toStart: 'მიდით მარშრუტის დასაწყისამდე',
    toResume: 'დაბრუნდით იქ, სადაც გაჩერდით',
    noWayBack: 'დაბრუნდით მარშრუტზე',
    done: 'მარშრუტი დასრულდა',
    report: (d, n, m) => `გავლილია ${d} კმ. ${n ? `გამოტოვებული მონაკვეთები: ${n} (${m}).` : 'არაფერი გამოტოვებულა.'}`,
    eta: (h, m) => (h ? `დარჩა ${h} სთ ${m} წთ` : `დარჩა ${m} წთ`),
    recenter: 'ცენტრში',
    menu: 'მენიუ',
    close: 'დახურვა',
    skipTurn: 'შემდეგ მოსახვევზე გადასვლა (ქუჩა დაკეტილია)',
    backTurn: 'ერთი მოსახვევით უკან',
    fromHere: 'გაგრძელება იქიდან, სადაც ვარ',
    showAll: 'მთელი დღის მარშრუტი რუკაზე',
    voice: 'ხმა',
    voiceOpts: { en: 'ინგლისური ხმა', ru: 'რუსული ხმა', ka: 'ქართული ხმა', beep: 'მხოლოდ სიგნალი', off: 'უხმოდ' },
    language: 'ენა',
    missedTitle: 'გამოტოვებული მონაკვეთები',
    missedNone: 'ჯერ არაფერი გამოტოვებულა.',
    missedAt: (a, len) => `${a} კმ-ზე · ${len}`,
    shareMissed: 'გამოტოვებულების გაგზავნა (GPX)',
    shareTrack: 'გავლილი ტრეკის გაგზავნა (GPX)',
    simulate: 'სავარჯიშო მგზავრობა (სიმულაცია)',
    simMiss: 'შემდეგი მოსახვევის გამოტოვება',
    simMissShort: 'მოსახვევის გამოტოვება', simStopShort: 'შეწყვეტა',
    simSpeed: 'სიჩქარე',
    stopSim: 'ვარჯიშის შეწყვეტა',
    endNav: 'ნავიგაციის შეწყვეტა',
    skipped: (m) => `გამოტოვდა ${m}: დაემატა სიაში`,
    goBack: 'უკან დაბრუნება',
    rejoined: 'ისევ მარშრუტზე ხართ',
    jumped: (m) => `გადახტა ${m}: დაემატა სიაში`,
    noPoints: 'ამ ფაილში მარშრუტის წერტილები არ არის.',
    readError: 'ფაილის წაკითხვა ვერ მოხერხდა.',
    gpsDenied: 'ამ გვერდისთვის მდებარეობა დაბლოკილია. iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using the App, შემდეგ გვერდი განაახლეთ.',
    gpsError: 'GPS სიგნალი ჯერ არ არის.',
    keepOn: 'ეკრანი რომ არ ჩაქრეს: Settings → Display & Brightness → Auto-Lock → Never.',
    offlineReady: 'ამ მარშრუტის რუკა შენახულია ინტერნეტის გარეშე გამოსაყენებლად',
    previewTitle: 'ამ მარშრუტის მოსახვევები',
    prev: 'წინა', next: 'შემდეგი', startHere: 'დაწყება ამ მოსახვევიდან',
    of: (i, n) => `${i} / ${n}`,
    about: 'ქუჩების მონაცემები © OpenStreetMap contributors. მარშრუტის ფაილი ამ ტელეფონზე რჩება.',
  },
};

/* ------------------------------------------------------------------ spoken prompts */

const ORD_EN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const ORD_RU = ['первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой'];

function spokenMeters(m) {
  if (m < 100) return Math.max(10, Math.round(m / 10) * 10);
  if (m < 500) return Math.round(m / 50) * 50;
  return Math.round(m / 100) * 100;
}

const SAY = {
  en: {
    act: {
      left: 'turn left', right: 'turn right', 'slight-left': 'bear left', 'slight-right': 'bear right',
      'sharp-left': 'make a sharp left', 'sharp-right': 'make a sharp right', 'keep-left': 'keep left',
      'keep-right': 'keep right', straight: 'go straight on', uturn: 'make a U-turn', arrive: 'the route ends',
      rejoin: 'you are back on the route', roundabout: (n) => `at the roundabout, take the ${ORD_EN[n - 1] || n + 'th'} exit`,
    },
    far: (d, a) => `In ${d} meters, ${a}.`,
    near: (a, t) => `${a[0].toUpperCase()}${a.slice(1)}${t ? `, then ${t}` : ''}.`,
    off: 'Off the route. Follow the orange line back.',
    rejoin: 'Back on the route.',
    skip: (m) => `Skipped ${m} meters. It is on the missed list.`,
    start: 'Drive to the start of the route.',
    resume: 'Drive back to where you stopped.',
    done: 'Route complete.',
    go: 'Navigation started.',
  },
  ru: {
    act: {
      left: 'поверните налево', right: 'поверните направо', 'slight-left': 'держитесь левее', 'slight-right': 'держитесь правее',
      'sharp-left': 'резко поверните налево', 'sharp-right': 'резко поверните направо', 'keep-left': 'держитесь левее',
      'keep-right': 'держитесь правее', straight: 'продолжайте прямо', uturn: 'развернитесь', arrive: 'маршрут заканчивается',
      rejoin: 'вы снова на маршруте', roundabout: (n) => `на круговом движении ${ORD_RU[n - 1] || n} съезд`,
    },
    far: (d, a) => `Через ${d} метров ${a}.`,
    near: (a, t) => `${a[0].toUpperCase()}${a.slice(1)}${t ? `, затем ${t}` : ''}.`,
    off: 'Вы сошли с маршрута. Следуйте по оранжевой линии.',
    rejoin: 'Вы снова на маршруте.',
    skip: (m) => `Пропущено ${m} метров. Это в списке пропущенных.`,
    start: 'Езжайте к началу маршрута.',
    resume: 'Вернитесь туда, где вы остановились.',
    done: 'Маршрут завершён.',
    go: 'Навигация началась.',
  },
  ka: {
    act: {
      left: 'მოუხვიეთ მარცხნივ', right: 'მოუხვიეთ მარჯვნივ', 'slight-left': 'ოდნავ მარცხნივ', 'slight-right': 'ოდნავ მარჯვნივ',
      'sharp-left': 'მკვეთრად მარცხნივ', 'sharp-right': 'მკვეთრად მარჯვნივ', 'keep-left': 'დარჩით მარცხენა მხარეს',
      'keep-right': 'დარჩით მარჯვენა მხარეს', straight: 'გააგრძელეთ პირდაპირ', uturn: 'შემობრუნდით', arrive: 'მარშრუტი მთავრდება',
      rejoin: 'ისევ მარშრუტზე ხართ', roundabout: (n) => `წრიულ მოძრაობაზე ${n === 1 ? 'პირველი' : `მე-${n}`} გასასვლელი`,
    },
    far: (d, a) => `${d} მეტრში ${a}.`,
    near: (a, t) => `${a}${t ? `, შემდეგ ${t}` : ''}.`,
    off: 'მარშრუტს გადაუხვიეთ. ნარინჯისფერ ხაზს მიჰყევით.',
    rejoin: 'ისევ მარშრუტზე ხართ.',
    skip: (m) => `გამოტოვდა ${m} მეტრი. დაემატა სიაში.`,
    start: 'მიდით მარშრუტის დასაწყისამდე.',
    resume: 'დაბრუნდით იქ, სადაც გაჩერდით.',
    done: 'მარშრუტი დასრულდა.',
    go: 'ნავიგაცია დაიწყო.',
  },
};

function act(L, m) {
  if (m.kind === 'roundabout') return L.act.roundabout(m.exit);
  return L.act[m.kind] || L.act.straight;
}

// Text to speak for a navigator event, or '' if nothing should be said
export function speech(lang, e) {
  const L = SAY[lang] || SAY.en;
  switch (e.type) {
    case 'prompt':
      if (e.stage === 'far') return L.far(spokenMeters(e.dist), act(L, e.m));
      return L.near(act(L, e.m), e.then ? act(L, e.then) : '');
    case 'off': return L.off;
    case 'rejoin': return L.rejoin;
    case 'skip': return L.skip(spokenMeters(e.meters));
    case 'start': return L.start;
    case 'resume': return L.resume;
    case 'done': return L.done;
    case 'go': return L.go;
    default: return '';
  }
}

export const VOICE_LANG = { en: 'en', ru: 'ru', ka: 'ka' };
