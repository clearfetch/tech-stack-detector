# Working on this Actor

```bash
npm install
./scripts/update-db.sh                 # downloads the fingerprint database, see the note below
ACTOR_TEST_PAY_PER_EVENT=true ACTOR_USE_CHARGING_LOG_DATASET=true node src/main.js
```

Input comes from `storage/key_value_stores/default/INPUT.json`. `scripts/run-test.sh <name>` copies one of the
files in `test-inputs/` into place, runs the Actor with charging simulated, and prints a summary.

`scripts/ground-truth.mjs` is the false-negative check: it re-fetches the sites from the last run and reports any
technology whose signature is present in the response but was not detected.

## About the fingerprint database

Detection patterns come from [enthec/webappanalyzer](https://github.com/enthec/webappanalyzer), which is
**GPL-3.0**. They are deliberately not committed here, because this repository is MIT and mixing the two would be
misleading about what you are allowed to do with each part. `scripts/update-db.sh` downloads them into
`data/technologies/`, and the Actor needs them to run.

`data/extra-technologies.json` is ours and is covered by this repository's MIT licence. It is merged on top of the
upstream database at load time, so an entry there adds detections without being overwritten by an update.
