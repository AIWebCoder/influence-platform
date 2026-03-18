const request = require('supertest');
const express = require('express');
const accountsRouter = require('../src/managers/accountsRouter');

// Mock AccountService
jest.mock('../src/managers/AccountService', () => ({
  getAccounts: jest.fn().mockResolvedValue([{ id: '1', username: 'testuser' }]),
  createAccount: jest.fn().mockResolvedValue({ id: '2', username: 'newuser', status: 'active' }),
  deleteAccount: jest.fn().mockResolvedValue(true)
}));

const app = express();
app.use(express.json());
app.use('/accounts', accountsRouter);

describe('Accounts API', () => {
  it('GET /accounts should return a list of accounts', async () => {
    const res = await request(app).get('/accounts');
    expect(res.statusCode).toEqual(200);
    expect(res.body.accounts.length).toBeGreaterThan(0);
  });

  it('POST /accounts should create an account', async () => {
    const res = await request(app)
      .post('/accounts')
      .send({ username: 'newuser', password: 'securepassword123' });
    expect(res.statusCode).toEqual(201);
    expect(res.body.username).toEqual('newuser');
  });

  it('DELETE /accounts/:id should delete an account', async () => {
    const res = await request(app).delete('/accounts/2');
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
  });
});
