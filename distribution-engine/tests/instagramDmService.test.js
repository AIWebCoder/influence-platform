const {
  mapParticipant,
  isSelfParticipant,
  normalizeUsername,
} = require('../src/engagement/instagramDmService');

describe('instagramDmService participants', () => {
  const identity = {
    igUserId: '26589280544071242',
    graphId: '26589280544071242',
    userId: null,
    username: 'my_multi_flow',
  };

  test('normalizeUsername strips @', () => {
    expect(normalizeUsername('@My_Multi_Flow')).toBe('my_multi_flow');
  });

  test('isSelfParticipant matches username', () => {
    expect(isSelfParticipant({ id: '17841474833532871', username: 'my_multi_flow' }, identity)).toBe(
      true,
    );
  });

  test('mapParticipant picks the other party, not the connected account', () => {
    const conversation = {
      participants: {
        data: [
          { id: '17841474833532871', username: 'my_multi_flow' },
          { id: '17841499999999999', username: 'fan_user_1' },
        ],
      },
      messages: {
        data: [{ message: 'Hey!', from: { id: '17841499999999999', username: 'fan_user_1' } }],
      },
    };
    const mapped = mapParticipant(conversation, identity);
    expect(mapped.participant_username).toBe('fan_user_1');
    expect(mapped.participant_id).toBe('17841499999999999');
    expect(mapped.preview).toBe('Hey!');
  });
});
