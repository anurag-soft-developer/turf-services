import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateTermsAndConditionsDto,
  UpdateTermsAndConditionsDto,
} from './dto/terms-and-conditions.dto';
import {
  TermsAndConditionsKind,
  TermsAndConditionsStatus,
} from './interfaces/terms-and-conditions.interface';
import {
  TermsAndConditions,
  TermsAndConditionsDocument,
} from './schemas/terms-and-conditions.schema';

const TERMS_USER_SELECT = '_id fullName avatar email phone';

@Injectable()
export class TermsAndConditionsService {
  private static readonly populateOptions = [
    { path: 'createdBy', select: TERMS_USER_SELECT },
    { path: 'publishedBy', select: TERMS_USER_SELECT },
  ];

  constructor(
    @InjectModel(TermsAndConditions.name)
    private readonly termsModel: Model<TermsAndConditionsDocument>,
  ) {}

  async getCurrent(kind: TermsAndConditionsKind) {
    const doc = await this.findLatestPublished(kind);
    if (!doc) {
      throw new NotFoundException('No published terms and conditions');
    }
    await doc.populate(TermsAndConditionsService.populateOptions);
    return doc.toObject();
  }

  async findLatestPublished(
    kind: TermsAndConditionsKind,
  ): Promise<TermsAndConditionsDocument | null> {
    return this.termsModel
      .findOne({ kind, status: TermsAndConditionsStatus.PUBLISHED })
      .sort({ publishedAt: -1, _id: -1 })
      .exec();
  }

  async listForAdmin(kind: TermsAndConditionsKind) {
    const docs = await this.termsModel
      .find({ kind })
      .populate(TermsAndConditionsService.populateOptions)
      .sort({ createdAt: -1 })
      .exec();
    return docs.map((doc) => doc.toObject());
  }

  async createDraft(adminId: string, dto: CreateTermsAndConditionsDto) {
    try {
      const created = await this.termsModel.create({
        kind: dto.kind,
        version: dto.version,
        title: dto.title,
        content: dto.content,
        status: TermsAndConditionsStatus.DRAFT,
        createdBy: new Types.ObjectId(adminId),
      });
      await created.populate(TermsAndConditionsService.populateOptions);
      return created.toObject();
    } catch (error) {
      this.rethrowDuplicateVersion(error);
    }
  }

  async updateDraft(id: string, dto: UpdateTermsAndConditionsDto) {
    const doc = await this.loadById(id);
    if (doc.status !== TermsAndConditionsStatus.DRAFT) {
      throw new BadRequestException('Published terms cannot be edited');
    }

    doc.version = dto.version;
    doc.title = dto.title;
    doc.content = dto.content;

    try {
      await doc.save();
    } catch (error) {
      this.rethrowDuplicateVersion(error);
    }

    await doc.populate(TermsAndConditionsService.populateOptions);
    return doc.toObject();
  }

  async publish(id: string, adminId: string) {
    const doc = await this.loadById(id);
    if (doc.status === TermsAndConditionsStatus.PUBLISHED) {
      throw new BadRequestException('This terms document is already published');
    }

    doc.status = TermsAndConditionsStatus.PUBLISHED;
    doc.publishedBy = new Types.ObjectId(adminId);
    doc.publishedAt = new Date();
    await doc.save();

    await doc.populate(TermsAndConditionsService.populateOptions);
    return doc.toObject();
  }

  private async loadById(id: string): Promise<TermsAndConditionsDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Terms and conditions not found');
    }
    const doc = await this.termsModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException('Terms and conditions not found');
    }
    return doc;
  }

  private rethrowDuplicateVersion(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    ) {
      throw new ConflictException(
        'A terms document with this version already exists for this audience',
      );
    }
    throw error;
  }
}
