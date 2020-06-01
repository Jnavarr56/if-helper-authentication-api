import * as e from 'express';
import * as dotenv from 'dotenv';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import BaseController from './BaseController';
import { AuthorizationResponse } from '../types/Response';
import {
	AccessTokenPayload,
	SystemAccessTokenPayload,
	DecodedAccessTokenPayload
} from '../types/Token';
import TokenBlacklist from '../util/TokenBlacklist';
import AuthTokenCache from '../util/AuthTokenCache';

dotenv.config();

const JWT_SECRET_KEY: string | undefined = process.env.JWT_SECRET_KEY;

const authTokenCache: AuthTokenCache = new AuthTokenCache();
const tokenBlacklist: TokenBlacklist = new TokenBlacklist();

export default class AuthorizeController extends BaseController {
	protected async executeImpl(req: e.Request, res: e.Response): Promise<void> {
		// 1) make sure token is present in request.
		const accessToken: string | undefined = req.token;
		if (!accessToken) {
			return this.missingAuthorizationToken(res);
		}

		// 2) check to make sure token is not blacklisted, if so reject.
		const isBlacklisted = await tokenBlacklist.isBlacklisted(accessToken);
		if (isBlacklisted) {
			return this.invalidToken(res);
		}

		// 4) Check for a cached token payload and return if it exists.
		const cachedPayload:
			| AccessTokenPayload
			| SystemAccessTokenPayload
			| null = await authTokenCache.getCachedPayload(accessToken);

		if (cachedPayload !== null) {
			const response: AuthorizationResponse = cachedPayload;
			return this.ok(res, response);
		}

		// 5) if not cached then decoded manually.
		if (typeof JWT_SECRET_KEY !== 'string')
			throw new Error('Invalid JWT Secret Key');

		jwt.verify(
			accessToken,
			JWT_SECRET_KEY,
			async (error: Error | null, decodedToken: any) => {
				// 6) reject if expired or invalid.
				if (error) {
					if (error instanceof TokenExpiredError) {
						return this.expiredToken(res);
					} else {
						return this.invalidToken(res);
					}
				}

				const decodedPayload: DecodedAccessTokenPayload = decodedToken;
				const { exp, iat, ...payload } = decodedPayload;

				// 7) calculate remaining lifespan.
				const ttl: number = exp - iat;
				await authTokenCache.cacheToken(accessToken, payload, ttl);

				// 8) send back access token payload.
				const accessTokenPayload: AccessTokenPayload = { ...payload };
				const response: AuthorizationResponse = accessTokenPayload;
				this.ok(res, response);
			}
		);
	}
}
