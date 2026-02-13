import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserLinkService } from './user-link.service';
import { UserLinkController } from './user-link.controller';

@Module({
  providers: [UserService, UserLinkService],
  controllers: [UserController, UserLinkController],
  exports: [UserService, UserLinkService],
})
export class UserModule {}
