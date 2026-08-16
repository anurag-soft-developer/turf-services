import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { OAuthProvider, User, UserDocument } from './schemas/user.schema';
import type {
  IUser,
  IOAuthStrategy,
  PublicProfile,
} from './interfaces/user.interface';
import { UpdateProfileDto } from '../auth/dto/auth.dto';
import type { Profile } from './interfaces/user.interface';
import { playerLeaderboardStatsFromEntry } from '../core/points/leaderboard-stats.helpers';
import type { PlayerLeaderboardRow } from '../core/points/ranking-points.types';
import type { PlayerSportEntry } from '../core/sports/sport-stats';
import type { PaginatedResult } from '../core/interfaces/common';
import {
  applyExcludeIds,
  paginateSortedByDistance,
  type NearbyLocationQuery,
} from '../core/utils/geo-near-page.util';
import type { UpdateNotificationSettingsDto } from './dto/users.dto';
import type { FcmTokenEntryPayload } from './dto/fcm-devices.dto';
import { UserRole } from '../auth/decorators/roles.decorator';
import { StorageLifecycleService } from '../storage/storage-lifecycle.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly storageLifecycle: StorageLifecycleService,
  ) {}

  async create(userData: Partial<IUser>): Promise<UserDocument> {
    if (userData.password) {
      const saltRounds = 12;
      userData.password = await bcrypt.hash(userData.password, saltRounds);
    }

    if (!userData.email && !userData.phone) {
      throw new BadRequestException('Email or phone is required');
    }

    if (userData.email) {
      userData.email = userData.email.toLowerCase();
      const existingByEmail = await this.findByEmail(userData.email);
      if (existingByEmail) {
        throw new ConflictException('User with this email already exists');
      }
    }

    if (userData.phone) {
      const existingByPhone = await this.findByPhone(userData.phone);
      if (existingByPhone) {
        throw new ConflictException('User with this phone already exists');
      }
    }

    const user = new this.userModel(userData);
    return await user.save();
  }

  async findById(id: string, projection?: string): Promise<UserDocument | null> {
    try {
      const query = this.userModel.findById(id);
      if (projection) {
        query.select(projection);
      }
      return await query.exec();
    } catch (error) {
      return null;
    }
  }

  async findByIdWithNotificationPrefs(
    id: string,
  ): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+fcmTokens').exec();
  }

  async findIdsByRoles(roles: UserRole[]): Promise<string[]> {
    if (!roles.length) {
      return [];
    }
    const ids = await this.userModel.distinct('_id', { role: { $in: roles } });
    return ids.map((id) => id.toString());
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return await this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+password')
      .exec();
  }

  async findByPhone(phone: string): Promise<UserDocument | null> {
    return await this.userModel.findOne({ phone }).exec();
  }

  async findByPhoneWithPassword(phone: string): Promise<UserDocument | null> {
    return await this.userModel.findOne({ phone }).select('+password').exec();
  }

  async findByPhoneWithOTP(phone: string): Promise<UserDocument | null> {
    return await this.userModel
      .findOne({ phone })
      .select('+otp +otpExpiry')
      .exec();
  }

  async findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return await this.userModel.findById(id).select('+password').exec();
  }

  async findByIdWithOTP(id: string): Promise<UserDocument | null> {
    return await this.userModel.findById(id).select('+otp +otpExpiry').exec();
  }

  async findByOAuthId(
    provider: string,
    oauthId: string,
  ): Promise<UserDocument | null> {
    return await this.userModel
      .findOne({
        'oAuthStrategies.provider': provider,
        'oAuthStrategies.id': oauthId,
      })
      .exec();
  }

  async updateById(
    id: string,
    updateData: Partial<IUser>,
  ): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      })
      .exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(
    id: string,
    updateData: UpdateProfileDto,
  ): Promise<UserDocument> {
    const { fullName, bio, avatar } = updateData;
    const allowedUpdates: Partial<IUser> = {
      ...(fullName !== undefined ? { fullName } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
    };

    if (avatar !== undefined) {
      const existing = await this.findById(id);
      if (!existing) {
        throw new NotFoundException('User not found');
      }

      const user = await this.updateById(id, allowedUpdates);
      await this.storageLifecycle.syncUrlArrayOnEntitySave({
        userId: id,
        entityType: 'user',
        entityId: id,
        previousUrls: existing.avatar ? [existing.avatar] : [],
        nextUrls: avatar ? [avatar] : [],
      });
      return user;
    }

    return await this.updateById(id, allowedUpdates);
  }

  async updateNotificationSettings(
    id: string,
    dto: UpdateNotificationSettingsDto,
  ): Promise<UserDocument> {
    const { notificationModules, ...rest } = dto;

    const updates: Partial<IUser> = { ...rest };

    if (notificationModules !== undefined) {
      const existing = await this.findById(id);
      if (!existing) {
        throw new NotFoundException('User not found');
      }
      updates.notificationModules = {
        ...(existing.notificationModules ?? {}),
        ...notificationModules,
      };
    }

    return this.updateById(id, updates);
  }

  async replaceFcmDevices(
    id: string,
    devices: FcmTokenEntryPayload[],
  ): Promise<UserDocument> {
    const fcmTokens = devices.map((e) => ({
      deviceKey: e.deviceKey,
      token: e.token,
      platform: e.platform,
      updatedAt: new Date(),
    }));
    return this.updateById(id, { fcmTokens } as Partial<IUser>);
  }

  async upsertFcmDevice(
    id: string,
    device: FcmTokenEntryPayload,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(id).select('+fcmTokens').exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const list = [...(user.fcmTokens || [])];
    const idx = list.findIndex((d) => d.deviceKey === device.deviceKey);
    const entry = {
      deviceKey: device.deviceKey,
      token: device.token,
      platform: device.platform,
      updatedAt: new Date(),
    };
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      if (list.length >= 20) {
        throw new BadRequestException('Maximum of 20 FCM devices allowed');
      }
      list.push(entry);
    }
    return this.updateById(id, { fcmTokens: list } as Partial<IUser>);
  }

  async removeFcmDevice(id: string, deviceKey: string): Promise<UserDocument> {
    const trimmedKey = deviceKey.trim();
    if (!trimmedKey) {
      throw new BadRequestException('deviceKey is required');
    }
    const user = await this.userModel.findById(id).select('+fcmTokens').exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const list = (user.fcmTokens || []).filter((d) => d.deviceKey !== trimmedKey);
    return this.updateById(id, { fcmTokens: list } as Partial<IUser>);
  }

  async changePassword(id: string, newPassword: string): Promise<void> {
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    await this.updateById(id, { password: hashedPassword });
  }

  async validatePassword(
    plainPassword: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  async addOAuthStrategy(
    userId: string,
    strategy: IOAuthStrategy,
  ): Promise<UserDocument> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.oAuthStrategies) {
      user.oAuthStrategies = [];
    }

    const existingStrategyIndex = user.oAuthStrategies.findIndex(
      (s) => s.provider === strategy.provider && s.id === strategy.id,
    );

    if (existingStrategyIndex >= 0) {
      // Update existing strategy
      user.oAuthStrategies[existingStrategyIndex] = strategy;
    } else {
      // Add new strategy
      user.oAuthStrategies.push(strategy);
    }

    return await user.save();
  }

  async createOrUpdateFromOAuth(
    email: string,
    oauthData: {
      provider: string;
      id: string;
      accessToken?: string;
      refreshToken?: string;
      fullName?: string;
      avatar?: string;
    },
  ): Promise<UserDocument> {
    const user = await this.findByEmail(email);

    if (
      !(Object.values(OAuthProvider) as string[]).includes(oauthData.provider)
    ) {
      throw new BadRequestException('Unsupported OAuth provider');
    }

    if (user) {
      const strategy: IOAuthStrategy = {
        provider: oauthData.provider as OAuthProvider,
        id: oauthData.id,
        accessToken: oauthData.accessToken,
        refreshToken: oauthData.refreshToken,
        createdAt: new Date(),
      };

      if (!user.fullName) {
        user.fullName = oauthData.fullName || '';
      }
      if (!user.avatar) {
        user.avatar = oauthData.avatar || '';
      }

      if (oauthData.provider === OAuthProvider.GOOGLE) {
        user.isEmailVerified = true;
      }

      if (!user.oAuthStrategies) {
        user.oAuthStrategies = [];
      }

      const existingStrategyIndex = user.oAuthStrategies.findIndex(
        (s) => s.provider === strategy.provider && s.id === strategy.id,
      );

      if (existingStrategyIndex >= 0) {
        user.oAuthStrategies[existingStrategyIndex] = strategy;
      } else {
        user.oAuthStrategies.push(strategy);
      }

      return await user.save();
    } else {
      // Create new user
      const newUserData: Partial<IUser> = {
        email: email.toLowerCase(),
        fullName: oauthData.fullName,
        avatar: oauthData.avatar,
        isEmailVerified: oauthData.provider === OAuthProvider.GOOGLE,
        oAuthStrategies: [
          {
            provider: oauthData.provider as OAuthProvider,
            id: oauthData.id,
            accessToken: oauthData.accessToken,
            refreshToken: oauthData.refreshToken,
            createdAt: new Date(),
          },
        ],
      };

      return await this.create(newUserData);
    }
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.updateById(id, { lastLogin: new Date().toString() });
  }

  async deactivateUser(id: string): Promise<UserDocument> {
    return await this.updateById(id, { isActive: false });
  }

  async activateUser(id: string): Promise<UserDocument> {
    return await this.updateById(id, { isActive: true });
  }

  async findByEmailWithOTP(email: string): Promise<UserDocument | null> {
    return await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+otp +otpExpiry')
      .exec();
  }

  async updateOTP(
    id: string,
    otpWithKey: string,
    otpExpiry: Date,
  ): Promise<void> {
    await this.updateById(id, {
      otp: otpWithKey,
      otpExpiry: otpExpiry,
    });
  }

  async clearOTP(id: string): Promise<void> {
    await this.updateById(id, {
      otp: undefined,
      otpExpiry: undefined,
    });
  }

  static sanitizeProfile(user: IUser | UserDocument): Profile {
    const createdAt =
      'createdAt' in user ? user.createdAt.toString() : new Date().toString();
    const updatedAt =
      'updatedAt' in user ? user.updatedAt.toString() : new Date().toString();
    const isPasswordExists = 'password' in user && !!user.password?.length;
    return {
      _id: user._id.toString(),
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      bio: user.bio,
      avatar: user.avatar,
      isActive: user.isActive,
      isVerified: user.isVerified,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      emailNotificationsEnabled: user.emailNotificationsEnabled,
      smsNotificationsEnabled: user.smsNotificationsEnabled,
      notificationsEnabled: user.notificationsEnabled,
      notificationModules: user.notificationModules,
      fcmTokens: user.fcmTokens || [],
      phone: user.phone,
      lastLogin: user.lastLogin?.toString(),
      isPasswordExists,
      playerSportStats: user.playerSportStats || [],
      sportRankingPoints: user.sportRankingPoints || [],
      badges: user.badges || [],
      followerCount: user.followerCount ?? 0,
      followingCount: user.followingCount ?? 0,
      createdAt,
      updatedAt,
    };
  }

  static sanitizePublicProfile(user: IUser | UserDocument): PublicProfile {
    const {
      fullName,
      avatar,
      bio,
      playerSportStats,
      sportRankingPoints,
      badges,
      isVerified,
    } = user;
    return {
      _id: user._id.toString(),
      fullName,
      avatar,
      bio,
      playerSportStats,
      sportRankingPoints,
      badges,
      isVerified,
      followerCount: user.followerCount ?? 0,
      followingCount: user.followingCount ?? 0,
    };
  }

  async getLeaderboard(
    sportType: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<PlayerLeaderboardRow>> {
    const skip = (page - 1) * limit;
    const baseStages = [
      { $match: { isActive: true } },
      { $unwind: '$sportRankingPoints' },
      { $match: { 'sportRankingPoints.sportType': sportType } },
    ];

    const [countAgg, rows] = await Promise.all([
      this.userModel.aggregate<{ total: number }>([
        ...baseStages,
        { $count: 'total' },
      ]),
      this.userModel.aggregate<{
        _id: { toString(): string };
        fullName?: string;
        avatar?: string;
        points: number;
        playerSportStats: PlayerSportEntry[];
      }>([
        ...baseStages,
        { $sort: { 'sportRankingPoints.points': -1, fullName: 1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            fullName: 1,
            avatar: 1,
            points: '$sportRankingPoints.points',
            playerSportStats: 1,
          },
        },
      ]),
    ]);

    const totalDocuments = countAgg[0]?.total ?? 0;

    const data = rows.map((u, index) => {
      const sportEntry = (u.playerSportStats ?? []).find(
        (e) => e.sportType === sportType,
      );
      return {
        rank: skip + index + 1,
        id: u._id.toString(),
        name: u.fullName?.trim() || 'Player',
        points: u.points ?? 0,
        stats: playerLeaderboardStatsFromEntry(sportEntry),
        ...(u.avatar ? { avatar: u.avatar } : {}),
      };
    });

    return {
      data,
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  async searchActivePublicProfiles(
    query?: string,
    page: number = 1,
    limit: number = 10,
    options?: {
      location?: NearbyLocationQuery;
      excludeIds?: string[];
      includeLastLocation?: boolean;
    },
  ): Promise<PaginatedResult<PublicProfile>> {
    const filter: Record<string, unknown> = { isActive: true };

    if (query) {
      filter.$or = [
        { fullName: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
      ];
    }

    applyExcludeIds(filter, options?.excludeIds);

    const toProfile = (user: UserDocument): PublicProfile => {
      const profile = UsersService.sanitizePublicProfile(user);
      if (options?.includeLastLocation && user.lastLocation) {
        return { ...profile, lastLocation: user.lastLocation };
      }
      return profile;
    };

    const location = options?.location;
    // Soft distance: prefer closer; nearbyRadiusKm ignored; no-location included last.
    if (
      location?.nearbyLat !== undefined &&
      location?.nearbyLng !== undefined
    ) {
      const result = await paginateSortedByDistance({
        model: this.userModel,
        geoKey: 'lastLocation',
        location,
        match: filter,
        page,
        limit,
        fallbackSort: { createdAt: -1 },
      });
      return {
        data: result.data.map((user) => toProfile(user)),
        totalDocuments: result.totalDocuments,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      };
    }

    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    return {
      data: users.map((user) => toProfile(user)),
      totalDocuments: total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /** Hydrate public profiles by id for explore feed session cache (order preserved). */
  async findPublicProfilesByIdsForExplore(
    ids: string[],
    options?: { includeLastLocation?: boolean },
  ): Promise<PublicProfile[]> {
    if (!ids.length) return [];
    const oids = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!oids.length) return [];
    const users = await this.userModel
      .find({ _id: { $in: oids }, isActive: true })
      .exec();
    const byId = new Map(
      users.map((user) => {
        const profile = UsersService.sanitizePublicProfile(user);
        const withLoc =
          options?.includeLastLocation && user.lastLocation
            ? { ...profile, lastLocation: user.lastLocation }
            : profile;
        return [user._id.toString(), withLoc] as const;
      }),
    );
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is PublicProfile => p != null);
  }

  async upsertLastLocation(
    userId: string,
    lat: number,
    lng: number,
  ): Promise<void> {
    await this.userModel.updateOne(
      { _id: userId },
      {
        $set: {
          lastLocation: { type: 'Point', coordinates: [lng, lat] },
        },
      },
    );
  }
}
