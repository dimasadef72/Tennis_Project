export type Usage = { inputTokens: number; outputTokens: number; totalTokens: number }

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

export function extractUsage(usage: any): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  }
}

export function sumUsage(usages: Usage[]): Usage {
  return usages.reduce(
    (acc, usage) => ({
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      totalTokens: acc.totalTokens + usage.totalTokens,
    }),
    emptyUsage(),
  )
}
