/* ───────────────────────────────────────────────────────────
   Peak Athlete · Upload Center
   upload-i18n.js — every user-facing string on the upload page.

   English only for now (Eric, 2026-10-10). Spanish is added by
   giving PA_UPLOAD_DICT an `es` block with the same keys; the
   page does not need to change. Kept separate from the
   dashboard's en.json / es.json on purpose (plan, rule zero).

   2026-10-13: trial-based allowance + upload queue.
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const en = {
    'brand.sub': 'Upload Center',
    'skip': 'Skip to the upload queue',
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

    'page.title': 'Upload sessions',
    'page.lede': 'Add the Templo files for one or more athletes, then upload them all in one go. Export one trial per file: smaller files upload more reliably.',

    // Adding files
    'add.title': 'Add files',
    'add.athlete': 'Athlete',
    'add.athlete.placeholder': 'Choose an athlete',
    'add.athlete.help': "Only athletes on your program's roster are listed. To add a swimmer, contact eric@mypeakathlete.com.",
    'add.athlete.option': '{name} (performance: {p} of {pmax} trials left, video: {v} of {vmax} clips left)',
    'add.type': 'Session type',
    'add.type.performance': 'Performance',
    'add.type.performance.help': 'Calibrated starts and turns. {n} trials per athlete per month.',
    'add.type.video': 'Video',
    'add.type.video.help': 'Clips for a technique breakdown. {n} clips per athlete per month.',
    'add.left': '{name} has {left} of {max} {unit} left this month.',
    'add.choose': 'Choose files',
    'add.drop': 'or drop files here',
    'add.help': 'Templo {types} files, up to {max} GB each. Each file is added as one trial (performance) or one clip (video); you can change that in the queue.',
    'add.needAthlete': 'Choose an athlete and a session type first.',
    'add.rejected': '{name} was not added: {reason}',
    'add.rejectType': 'not a Templo {types} file',
    'add.rejectSize': 'larger than {max} GB',
    'add.rejectEmpty': 'the file is empty',
    'add.added': '{n} file(s) added to the queue for {name}.',

    'unit.trials': 'trials',
    'unit.clips': 'clips',

    // Queue
    'queue.title': 'Upload queue',
    'queue.empty': 'No files in the queue yet. Add files above.',
    'queue.caption': 'Files waiting to upload, in order',
    'queue.summary': '{files} file(s), {size} in total',
    'col.file': 'File',
    'col.athlete': 'Athlete',
    'col.contents': 'Contents',
    'col.status': 'Status',
    'col.actions': 'Actions',
    'q.starts': 'Starts',
    'q.turns': 'Turns',
    'q.clips': 'Clips',
    'q.startsLabel': 'Starts in {file}',
    'q.turnsLabel': 'Turns in {file}',
    'q.clipsLabel': 'Clips in {file}',
    'q.remove': 'Remove',
    'q.removeLabel': 'Remove {file} from the queue',
    'q.cancelLabel': 'Cancel the upload of {file}',
    'q.overBudget': 'Over the monthly limit: {name} has {left} {unit} left. Remove files or lower the counts.',
    'q.trialsInvalid': 'Each performance file needs 1 to {max} trials (starts + turns).',
    'q.clipsInvalid': 'Each video file needs 1 to {max} clips.',
    'q.calibration': 'The cameras were calibrated for every performance file in this queue',
    'q.calibration.help': 'Performance data is only valid on calibrated cameras. Sessions without a valid calibration have to be captured again.',
    'q.calibrationMissing': 'Confirm the cameras were calibrated before uploading performance files.',
    'q.uploadAll': 'Upload all',
    'q.pause': 'Pause',
    'q.resume': 'Resume',
    'q.clearDone': 'Clear finished',

    'q.uploadAnyway': 'Upload anyway',
    'q.uploadAnywayLabel': 'Upload {file} anyway',
    'q.checking': 'Checking file…',

    // Duplicate warnings (warn, never block: Eric 2026-10-13)
    'dup.queue': 'Same file as another file in this queue.',
    'dup.same': 'Already uploaded {date} for {name} ({status}).',
    'dup.other': 'This file was uploaded {date} for {name}. Check that you picked the right athlete.',
    'dup.recapture': 'This is the file that was sent back ({reason}). Capture the trial again and upload the new file.',
    'dup.allowed': 'Will upload anyway (flagged for Peak Athlete).',
    'dupdlg.title': 'Some files may have been uploaded before',
    'dupdlg.body': 'Uploading them again uses trials and can duplicate work. Remove them, or upload anyway: Peak Athlete sees that they were flagged.',
    'dupdlg.remove': 'Remove these files',
    'dupdlg.anyway': 'Upload anyway',
    'dupdlg.back': 'Go back',

    'qs.ready': 'Waiting',
    'qs.needsFile': 'Choose the file again',
    'qs.starting': 'Starting…',
    'qs.uploading': 'Uploading {pct}%',
    'qs.completing': 'Checking the file…',
    'qs.paused': 'Paused at {pct}%',
    'qs.done': 'Received',
    'qs.error': 'Stopped: {reason}',
    'qs.cancelled': 'Cancelled',

    'q.reminders.title': 'Before you upload',
    'q.reminder.oneAthlete': 'One athlete per file. Export one trial per file when you can.',
    'q.reminder.trials': 'Performance: declare the starts and turns in each file. If a file has more, we process only what you declare.',
    'q.reminder.calibration': 'Calibrate the cameras before every performance session.',
    'q.reminder.awake': 'Large files take a while. Use a wired connection if you can, keep the computer plugged in, and keep this page open. Uploads continue automatically if the connection drops.',

    // Overall progress
    'progress.title': 'Upload progress',
    'progress.label': 'Overall progress',
    'progress.overall': '{done} of {files} files, {sent} of {total}',
    'progress.speed': '{rate}/s, {eta} left',
    'progress.measuring': 'Measuring upload speed…',
    'progress.current': 'Now uploading: {file} ({name})',
    'progress.running': 'Uploading. Keep this page open and the computer awake until the queue finishes.',
    'progress.paused': 'Paused. Everything already sent is saved.',
    'progress.finished': 'Queue finished. Peak Athlete will review the files; results and the monthly report appear in the Performance Lab.',
    'progress.retrying': 'The connection was interrupted. Retrying automatically in {s} s (attempt {n}). Nothing to do: the upload continues on its own.',
    'progress.retryingNow': 'The connection was interrupted. Retrying now (attempt {n})…',
    'progress.retryingAuth': 'Renewing your sign-in, then continuing automatically (attempt {n})…',
    'progress.retryAnnounce': 'Connection interrupted. The upload will retry automatically.',
    'progress.reconnected': 'Connection restored. Upload continuing.',
    'progress.fileDone': '{file} received.',
    'progress.awake': 'This page is keeping the screen on while uploads run.',
    'progress.leaveWarning': 'Uploads are in progress. Leaving now pauses them.',
    'eta.lessThanMinute': 'under a minute',
    'eta.minutes': 'about {m} min',
    'eta.hours': 'about {h} h {m} min',

    // Restoring a queue after the page was closed
    'restore.title': 'Continue where you stopped',
    'restore.body': '{n} file(s) from your last visit have not finished. Their progress is saved.',
    'restore.continue': 'Continue the queue',
    'restore.continueHelp': 'Your browser will ask to let this page read the files again.',
    'restore.choose': 'Choose the files again',
    'restore.chooseHelp': 'Select the same files; they are matched automatically.',
    'restore.matched': '{n} file(s) matched. Press Upload all to continue.',
    'restore.unmatched': '{n} file(s) did not match any unfinished upload and were not added.',
    'restore.discard': 'Cancel these uploads',

    // Confirm dialogs
    'cancel.title': 'Cancel this upload?',
    'cancel.body': 'The file is deleted and its trials go back to this month.',
    'cancel.confirm': 'Cancel upload',
    'cancel.keep': 'Keep it',
    'discard.title': 'Cancel the unfinished uploads?',
    'discard.body': 'Files from your last visit are deleted and their trials go back to this month.',

    // Month + recent uploads
    'month.title': 'This month: {month}',
    'month.caption': 'Trials and clips used per athlete this month',
    'month.empty': 'No athletes on the roster yet.',
    'month.cell': '{used} of {max}',
    'col.performance': 'Performance trials',
    'col.video': 'Video clips',
    'col.date': 'Date',
    'col.session': 'Session',
    'col.notes': 'Notes',
    'uploads.title': 'Recent uploads',
    'uploads.caption': 'Uploads from the last 90 days',
    'uploads.empty': 'No uploads yet.',
    'uploads.withdraw': 'Withdraw',
    'uploads.withdrawLabel': 'Withdraw the {type} upload for {name} from {date}',
    'uploads.unknownAthlete': 'Former athlete',
    'uploads.perf': '{s} starts, {t} turns',
    'uploads.video': '{n} clips',
    'uploads.accepted': '{n} accepted',
    'uploads.replaced': 'Uploaded again on {date}',
    'uploads.flagged': 'Flagged as a possible duplicate',
    'uploads.byOther': 'Started by another coach',
    'sec.action': 'Needs your action',
    'sec.progress': 'In progress',
    'sec.received': 'Received, awaiting review',
    'sec.done': 'Done',
    'sec.closed': 'Cancelled and replaced ({n})',
    'status.unfinished': "Didn't finish",
    'status.expired': "Didn't finish (expired)",
    'btn.resume': 'Resume',
    'btn.again': 'Upload again',
    'btn.newCapture': 'Upload new capture',
    'btn.resumeLabel': 'Resume the {type} upload for {name} from {date}',
    'btn.againLabel': 'Upload the {type} file for {name} from {date} again',
    'btn.newCaptureLabel': 'Upload a new capture for {name} to replace the {type} upload from {date}',
    'retry.mismatch': "That isn't the same file. Choose the file that was being uploaded.",
    'retry.added': 'Added to the queue. Press Upload all to start.',

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
    'code.no_trials_left': 'not enough left for this athlete this month ({remaining} left).',
    'code.possible_duplicate': 'this file looks like one that was already uploaded.',
    'code.wrong_trial_count': 'the number of trials is not valid.',
    'code.wrong_clip_count': 'the number of clips is not valid.',
    'code.calibration_not_confirmed': 'the calibration was not confirmed.',
    'code.file_type_not_allowed': 'this file type is not accepted.',
    'code.file_size_not_allowed': 'the file is too large.',
    'code.upload_incomplete': 'some parts of the file did not arrive. Resume to send them again.',
    'code.not_allowed': 'this upload can no longer be changed.',
    'code.upload_gone': 'this upload no longer exists on the server (it was cancelled or expired). Add the file again.',
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
