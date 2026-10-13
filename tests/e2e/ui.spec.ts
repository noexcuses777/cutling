import { test, expect } from '@playwright/test';

test('home defaults → pasted resource → persisted memo → roadmap completion through UI', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const projectTitle = `파이썬 독학 UI ${Date.now()}`;
  const resourceTitle = '파이썬 함수와 반복문 학습 기록';
  const memo = '함수는 작은 책임부터 나누고, 반복문은 입력 데이터의 범위를 확인하기.';

  await page.request.get('/api/bootstrap');
  await page.request.patch('/api/settings', { data: { mode: 'rules' } });
  await page.goto('/');
  await page.getByRole('textbox', { name: '새 프로젝트 검색어' }).fill(projectTitle);
  await page.getByText('학습 수준과 목표 설정', { exact: false }).click();
  await page.getByRole('checkbox', { name: '프로젝트를 만들고 네이버 검색도 열기' }).uncheck();
  await expect(page.getByPlaceholder('예: 작은 이미지 분류 모델 만들기')).toHaveValue('');
  await page.getByRole('button', { name: '프로젝트 만들기', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+$/);
  await expect(page.getByRole('heading', { name: projectTitle, exact: true })).toBeVisible();

  await page.getByRole('button', { name: '자료 담기', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '배움에 필요한 자료 담기' });
  await expect(dialog.getByRole('button', { name: '클립보드에서 URL 붙여넣기' })).toBeVisible();
  await dialog.getByRole('tab', { name: '본문 붙여넣기', exact: true }).click();
  await dialog.getByRole('textbox', { name: '자료 제목', exact: true }).fill(resourceTitle);
  await dialog.getByRole('textbox', { name: '복사한 본문', exact: true }).fill([
    '파이썬은 변수에 값을 저장하고 함수를 사용해 반복되는 작업을 정리할 수 있는 프로그래밍 언어입니다.',
    '함수는 입력값을 받아 계산하고 결과를 반환합니다. 작은 기능을 각각의 함수로 나누면 코드를 쉽게 이해할 수 있습니다.',
    '반복문은 리스트의 원소를 순서대로 처리합니다. 조건문과 함께 사용하면 필요한 데이터를 선택해 계산할 수 있습니다.',
    '처음 학습할 때에는 변수, 자료형, 조건문, 반복문, 함수를 익힌 뒤 작은 프로젝트에서 함께 활용합니다.',
  ].join('\n\n'));
  await dialog.getByRole('button', { name: '자료 담기', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: resourceTitle, exact: true }) }).first().click();
  await expect(page).toHaveURL(/\/archive\/[^/?]+/);
  await expect(page.getByRole('heading', { name: resourceTitle, exact: true })).toBeVisible();
  await expect(page.locator('.summary-lines > li')).toHaveCount(3, { timeout: 30000 });
  await page.getByRole('textbox', { name: '개인 메모', exact: true }).fill(memo);
  await page.getByRole('button', { name: '메모 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('메모와 태그를 저장했어요.');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '개인 메모', exact: true })).toHaveValue(memo);

  await page.getByRole('link', { name: '학습 로드맵', exact: true }).click();
  const firstStage = page.locator('.roadmap-stage').first();
  await firstStage.getByRole('button', { name: '완료 표시', exact: true }).click();
  await expect(firstStage.getByRole('button', { name: '완료했어요', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('.roadmap-stage').first().getByRole('button', { name: '완료했어요', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
