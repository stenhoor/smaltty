// TypeScript with smaltdf: frames and expressions that run as plans in the smaltdb engine.
// Ctrl+Enter runs the tab. Its last expression is shown; show(value, title) shows more.
const lines = table('orders')
  .filter(col('status').ne('cancelled'))
  .join(table('products'), { leftOn: 'product_id', rightOn: 'id' })
  .withColumns(col('quantity').mul(col('price')).alias('amount'));

show(
  lines
    .groupBy('category')
    .agg(col('amount').sum().round(2).alias('revenue'), len().alias('lines'))
    .sort('revenue', { descending: true }),
  'By category',
);

// The ten largest order lines
lines
  .select('id', 'ordered_at', 'name', 'quantity', 'amount')
  .sort('amount', { descending: true })
  .head(10)
