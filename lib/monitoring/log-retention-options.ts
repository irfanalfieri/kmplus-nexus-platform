/** MN-7: the retention choices a workspace admin has (client-safe). Detailed logs never outlive summaries. */
export const LOG_DETAIL_DAYS = [7, 30, 90] as const
export const RUN_SUMMARY_DAYS = [90, 365, 730] as const
