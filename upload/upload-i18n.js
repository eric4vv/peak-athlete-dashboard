/* ───────────────────────────────────────────────────────────
   Peak Athlete · Upload Center
   upload-i18n.js — every user-facing string on the upload page.

   English only for now (Eric, 2026-10-10). Spanish is added by
   giving PA_UPLOAD_DICT an `es` block with the same keys; the
   page does not need to change. Kept separate from the
   dashboard's en.json / es.json on purpose (plan, rule zero).
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const en = {
    'brand.sub': 'Upload Center',
    'skip': 'Skip to the upload form',
    'nav.backToLab': 'Back to Performance Lab',
    'nav.signOut': 'Sign out',
    'nav.signedInAs': 'Signed in as {email}',

    'state.loading': 'Checking your account…',

    'signedOut.title': 'Sign in to upload',
    'signedOut.body': 'Uploads use your Performance Lab coach account. Sign in to the Performance Lab, then come back to this page.',
    'signedOut.signIn': 'Open the Performance Lab sign-in',
    'signedOut.recheck': "I've signed in",

    'notCoach.title': 'This page is for program coaches',
    'notCoach.body': 'Session uploads are available to coaches on a Peak Athlete system-owner program. If you think this is wrong, contact eric@mypeakathlete.com.',
    'inactive.title': 'Uploads are not active for your team',
    'inactive.body': "Your team doesn't have an active upload program. Contact eric@mypeakathlete.com to set one up.",
    'loadError.title': "We couldn't load your program",
    'loadError.body': 'Check your internet connection and try again.',
    'loadError.retry': 'Try again',

    'narrow': 'Uploads work best on the desktop or laptop computer that runs Templo. Large files can take a long time on a phone or tablet.',

    'page.title': 'Upload a session',
    'form.title': 'New upload',
    'form.athlete': 'Athlete',
    'form.athlete.placeholder': 'Choose an athlete',
    'form.athlete.help': "Only athletes on your program's roster are listed. To add a swimmer, contact eric@mypeakathlete.com.",
    'form.athlete.option': '{name} (Performance {p} of {pmax}, Video {v} of {vmax})',
    'form.type': 'Session type',
    'form.type.performance': 'Performance session',
    'form.type.performance.help': '{n} calibrated trials: starts, turns or a mix.',
    'form.type.video': 'Video session',
    'form.type.video.help': '{n} clips for a technique breakdown.',
    'form.allowance.left': 'Included this month: {left} of {max} left.',
    'form.allowance.extra': 'The included {type} session for this month is used. This upload will be an extra session at {price}.',
    'form.contents': 'What is in the file',
    'form.starts': 'Starts',
    'form.turns': 'Turns',
    'form.decrease': 'Fewer {what}',
    'form.increase': 'More {what}',
    'form.trialTotal': '{total} of {n} trials',
    'form.calibration': 'The cameras were calibrated for this session',
    'form.calibration.help': 'Performance data is only valid on calibrated cameras. Sessions without a valid calibration have to be captured again.',
    'form.clips': 'This file contains {n} clips',
    'form.file': 'Templo session file',
    'form.file.choose': 'Choose file',
    'form.file.drop': 'or drop the file here',
    'form.file.help': 'A Templo {types} file, up to {max} GB.',
    'form.file.none': 'No file chosen',
    'form.reminders.title': 'Before you upload',
    'form.reminder.oneAthlete': 'One athlete per file.',
    'form.reminder.trials': 'Performance: exactly {n} trials. If the file has more, we process the {n} you declare and ignore the rest.',
    'form.reminder.clips': 'Video: exactly {n} clips.',
    'form.reminder.calibration': 'Calibrate the cameras before every performance session.',
    'form.reminder.awake': 'Session files are large and can take an hour or more to upload. Use a wired connection if you can, keep the computer plugged in and set it not to sleep, and keep this page open until the upload finishes.',
    'form.submit': 'Upload session',
    'form.submitting': 'Starting upload…',
    'form.errors.title': 'Please fix the following:',

    'err.athlete': 'Choose an athlete.',
    'err.type': 'Choose a session type.',
    'err.trials': 'Starts and turns must add up to {n}.',
    'err.calibration': 'Confirm the cameras were calibrated.',
    'err.clips': 'Confirm the file contains {n} clips.',
    'err.file': 'Choose a Templo session file.',
    'err.fileType': 'This file type is not accepted. Choose a Templo {types} file.',
    'err.fileSize': 'This file is larger than {max} GB.',

    'extra.title': 'Upload as an extra session?',
    'extra.body': '{name} has already used the included {type} session for {month}. This upload will be billed to your program as an extra session at {price}.',
    'extra.confirm': 'Upload as extra session ({price})',
    'extra.cancel': 'Go back',

    'progress.title': 'Upload in progress',
    'progress.label': 'Upload progress',
    'progress.detail': '{sent} of {total}',
    'progress.speed': '{rate}/s, about {eta} left',
    'progress.retrying': 'The connection was interrupted. Retrying automatically in {s} s (attempt {n}). Nothing to do: the upload continues on its own.',
    'progress.retryingNow': 'The connection was interrupted. Retrying now (attempt {n})…',
    'progress.retryingAuth': 'Renewing your sign-in, then continuing automatically (attempt {n})…',
    'progress.retryAnnounce': 'Connection interrupted. The upload will retry automatically.',
    'progress.reconnected': 'Connection restored. Upload continuing.',
    'progress.awake': 'This page is keeping the screen on while the upload runs.',
    'progress.measuring': 'Measuring upload speed…',
    'eta.lessThanMinute': 'less than a minute',
    'eta.minutes': '{m} min',
    'eta.hours': '{h} h {m} min',
    'progress.status.uploading': 'Uploading. Keep this page open and the computer awake until the upload finishes.',
    'progress.status.paused': 'Paused. The parts already sent are saved.',
    'progress.status.completing': 'Checking the file…',
    'progress.status.done': 'Upload received. Peak Athlete will review it, and the results will appear in the Performance Lab.',
    'progress.status.error': 'The upload stopped: {reason}',
    'progress.status.cancelled': 'Upload cancelled.',
    'progress.announce': 'Upload {pct} percent complete',
    'progress.extra': 'Extra session, {price}',
    'progress.pause': 'Pause',
    'progress.resume': 'Resume',
    'progress.cancel': 'Cancel upload',
    'progress.another': 'Upload another session',
    'progress.leaveWarning': 'An upload is in progress. Leaving now pauses it.',

    'cancel.title': 'Cancel this upload?',
    'cancel.body': 'The file will be deleted and the session will not count toward this month.',
    'cancel.confirm': 'Cancel upload',
    'cancel.keep': 'Keep it',

    'resume.title': 'Unfinished upload',
    'resume.body': '{name}, {type} session. Choose the same file again to continue where it stopped.',
    'resume.choose': 'Choose the same file',
    'resume.mismatch': "That isn't the same file. Choose the file you started uploading.",
    'resume.discard': 'Cancel this upload',

    'month.title': 'This month: {month}',
    'month.caption': 'Sessions used per athlete this month',
    'month.empty': 'No athletes on the roster yet.',
    'col.athlete': 'Athlete',
    'col.performance': 'Performance',
    'col.video': 'Video',
    'col.date': 'Date',
    'col.session': 'Session',
    'col.status': 'Status',
    'col.notes': 'Notes',
    'col.actions': 'Actions',
    'uploads.title': 'Recent uploads',
    'uploads.caption': 'Uploads from the last 90 days',
    'uploads.empty': 'No uploads yet.',
    'uploads.extra': 'Extra session, {price}',
    'uploads.withdraw': 'Withdraw',
    'uploads.withdrawLabel': 'Withdraw the {type} upload for {name} from {date}',
    'uploads.unknownAthlete': 'Former athlete',

    'status.uploading': 'Not finished',
    'status.received': 'Received, awaiting review',
    'status.accepted': 'Accepted, analysis in progress',
    'status.delivered': 'Results in the Performance Lab',
    'status.recapture': 'Capture again',
    'status.cancelled': 'Cancelled',
    'reason.no_valid_calibration': 'No valid calibration',
    'reason.wrong_trial_count': 'Wrong number of trials',
    'reason.wrong_athlete': 'Wrong athlete in the file',
    'reason.file_unreadable': 'File could not be opened',
    'reason.other': 'See note',
    'type.performance': 'performance',
    'type.video': 'video',
    'type.performance.title': 'Performance',
    'type.video.title': 'Video',

    'code.network': 'the connection dropped. Check the internet connection, then resume.',
    'code.storage_unavailable': 'the storage service did not respond. Try again in a few minutes.',
    'code.athlete_not_on_roster': 'this athlete is not on your program roster.',
    'code.consent_missing': "this athlete hasn't accepted the current Performance Lab terms. Ask them to sign in to the Performance Lab once.",
    'code.program_inactive': "your team's upload program is not active.",
    'code.not_active_coach': 'your account is not an active coach on this program.',
    'code.wrong_trial_count': 'starts and turns must add up to the required number of trials.',
    'code.wrong_clip_count': 'the clip count does not match.',
    'code.calibration_not_confirmed': 'the calibration was not confirmed.',
    'code.file_type_not_allowed': 'this file type is not accepted.',
    'code.file_size_not_allowed': 'the file is too large.',
    'code.upload_incomplete': 'some parts of the file did not arrive. Resume to send them again.',
    'code.not_allowed': 'this upload can no longer be changed.',
    'code.upload_gone': 'this upload no longer exists on the server (it was cancelled or expired). Start a new upload.',
    'code.unauthorized': 'your sign-in expired. Sign in again, then resume.',
    'code.default': 'something went wrong (code {code}).',

    'footer': 'Files are encrypted in transit and stored privately. They are removed from the upload inbox within 30 days.',
  };

  const DICT = { en };
  let lang = 'en';

  function t(key, vars) {
    const table = DICT[lang] || DICT.en;
    let s = table[key] !== undefined ? table[key] : (DICT.en[key] !== undefined ? DICT.en[key] : key);
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
    }
    return s;
  }

  window.PA_UPLOAD_DICT = DICT;
  window.PA_UPLOAD_T = t;
  window.PA_UPLOAD_SET_LANG = (l) => { if (DICT[l]) lang = l; };
})();
