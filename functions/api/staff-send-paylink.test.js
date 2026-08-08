import { describe, expect, it } from 'vitest';
import { PAY_LINK_PRODUCTS, buildMessage } from './staff-send-paylink.js';

describe('staff pay-link catalog', () => {
  it('offers the current 6- and 12-week Practices at the verified prices', () => {
    expect(PAY_LINK_PRODUCTS['6-week-practice']).toMatchObject({
      name: '6-Week Amari Practice',
      price: '$3,000',
      path: '/payment-link/6a6833c27b99151a54040da5',
    });
    expect(PAY_LINK_PRODUCTS['12-week-practice']).toMatchObject({
      name: '12-Week Amari Practice',
      price: '$5,400',
      path: '/payment-link/6a66ce547b99151a540409b0',
    });
  });

  it('keeps the text price and checkout URL server-owned', () => {
    expect(buildMessage(PAY_LINK_PRODUCTS['6-week-practice'])).toBe(
      "Here's your payment link for the 6-Week Amari Practice ($3,000):\n\nhttps://link.amarimethod.com/payment-link/6a6833c27b99151a54040da5",
    );
  });
});
