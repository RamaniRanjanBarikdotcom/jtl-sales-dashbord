import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RevokedToken } from '../../entities/revoked-token.entity';
import { RequestUser } from '../../common/types/auth-request';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(RevokedToken)
    private readonly revokedRepo: Repository<RevokedToken>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: RequestUser) {
    if (payload.jti) {
      const revoked = await this.revokedRepo.findOne({ where: { jti: payload.jti } });
      if (revoked) throw new UnauthorizedException('Token revoked');
    }
    return payload;
  }
}
