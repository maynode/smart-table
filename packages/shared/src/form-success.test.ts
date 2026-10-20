import { buildSuccessValues, renderSuccessTemplate } from './form-success';

describe('success page variables', () => {
  it('stepOutputs override same-named formCells', () => {
    const values = buildSuccessValues({
      formCells: { 手机号: '13800000000', 序列号: 'FROM-FORM' },
      stepOutputs: { 序列号: 'TEST-01' },
    });

    expect(values['手机号']).toBe('13800000000');
    expect(values['序列号']).toBe('TEST-01');
    expect(
      renderSuccessTemplate('领取成功，你的序列号是 {{序列号}}', values),
    ).toBe('领取成功，你的序列号是 TEST-01');
  });

  it('keeps unknown variables instead of throwing', () => {
    expect(renderSuccessTemplate('你好 {{未知字段}}', {})).toBe(
      '你好 {{未知字段}}',
    );
  });

  it('escapes interpolated values', () => {
    expect(
      renderSuccessTemplate('{{名字}}', { 名字: '<img src=x onerror=alert(1)>' }),
    ).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
});
