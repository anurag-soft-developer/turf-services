import { Test, TestingModule } from '@nestjs/testing';
import { SocketModule } from './../src/socket.module';

describe('SocketModule (e2e)', () => {
  it('compiles', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [SocketModule],
    }).compile();

    expect(moduleFixture).toBeDefined();
  });
});
