import { collectLatestTweets } from "./twitter-collector.mjs";

collectLatestTweets()
  .then((result) => {
    console.log(
      `[twitter] accounts=${result.accounts} fetched=${result.fetched} created=${result.created} updated=${result.updated} skipped=${result.skipped}`,
    );
  })
  .catch((error) => {
    console.error("[twitter] Collect task failed:", error);
    process.exitCode = 1;
  });
