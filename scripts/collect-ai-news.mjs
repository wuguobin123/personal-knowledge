import { collectDailyAiNews } from "./ai-news-collector.mjs";

(async () => {
  try {
    const result = await collectDailyAiNews();
    console.log(
      `[ai-news] date=${result.targetDateKey} fetched=${result.fetched} created=${result.created} updated=${result.updated} skipped=${result.skipped}`,
    );
  } catch (error) {
    console.error("[ai-news] Collect task failed:", error);
    process.exitCode = 1;
  }
})();
