import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Hr,
} from '@react-email/components';
import { emailStyles } from './email-styles';
import { config } from '../../config/env.config';

interface TeamInviteEmailTemplateProps {
  inviteeName?: string;
  inviterName: string;
  teamName: string;
  companyName?: string;
}

export const TeamInviteEmailTemplate = ({
  inviteeName,
  inviterName = 'A team owner',
  teamName = 'a team',
  companyName = config.APP_NAME,
}: TeamInviteEmailTemplateProps) => {
  const greeting = inviteeName ? `Hi ${inviteeName},` : 'Hi,';

  return (
    <Html>
      <Head />
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Section style={emailStyles.logoContainer}>
            <Text style={emailStyles.logo}>{companyName}</Text>
          </Section>

          <Heading style={emailStyles.heading}>Team invitation</Heading>

          <Text style={emailStyles.text}>{greeting}</Text>

          <Text style={emailStyles.text}>
            <strong>{inviterName}</strong> invited you to join{' '}
            <strong>{teamName}</strong> on {companyName}.
          </Text>

          <Text style={emailStyles.text}>
            Open the app, sign up or log in with this email if needed, then go
            to <strong>Invitations</strong> to accept or decline.
          </Text>

          <Hr style={emailStyles.hr} />

          <Text style={emailStyles.footer}>
            Best regards,
            <br />
            The {companyName} Team
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default TeamInviteEmailTemplate;
