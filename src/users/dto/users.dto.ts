import { createZodDto, type ZodDto } from 'nestjs-zod';
import { z } from 'zod';

const SearchUsersListSchema = z.object({
  query: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const UpdateNotificationSettingsSchema = z.object({
  emailNotificationsEnabled: z.boolean().optional(),
  smsNotificationsEnabled: z.boolean().optional(),
});

const UpdateNotificationSettingsDtoBase: ZodDto<
  typeof UpdateNotificationSettingsSchema
> = createZodDto(UpdateNotificationSettingsSchema);
const SearchUsersListDtoBase: ZodDto<typeof SearchUsersListSchema> =
  createZodDto(SearchUsersListSchema);

export class UpdateNotificationSettingsDto extends UpdateNotificationSettingsDtoBase {}
export class SearchUsersListDto extends SearchUsersListDtoBase {}
