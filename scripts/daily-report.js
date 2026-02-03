#!/usr/bin/env node
const { aggregateDaily, aggregateOverall } = require('../server/metrics');

async function main() {
  const args = process.argv.slice(2);
  const dateArg = args.find((arg) => arg.startsWith('--date='));
  const overallFlag = args.includes('--overall') || args.includes('--scope=overall');

  if (overallFlag && dateArg) {
    console.error('`--overall`와 `--date=` 옵션은 동시에 사용할 수 없습니다.');
    process.exit(1);
  }

  const date = overallFlag ? null : (dateArg ? dateArg.split('=')[1] : today());

  if (!overallFlag) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.error('날짜 형식이 잘못되었습니다. YYYY-MM-DD 형식으로 입력하세요.');
      process.exit(1);
    }
  }

  try {
    const summary = overallFlag ? await aggregateOverall() : await aggregateDaily(date);
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error('통계 집계 중 오류가 발생했습니다:', err.message || err);
    process.exit(1);
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

main();
