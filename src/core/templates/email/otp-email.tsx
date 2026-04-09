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

interface OtpEmailTemplateProps {
  userFullName: string;
  otpCode: string;
  title: string;
  instructionText: string;
  companyName?: string;
}

export const OtpEmailTemplate = ({
  userFullName = 'User',
  otpCode = '123456',
  title = 'Your OTP Code',
  instructionText = 'Use this one-time password to continue.',
  companyName = config.APP_NAME,
}: OtpEmailTemplateProps) => {
  return (
    <Html>
      <Head />
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Section style={emailStyles.logoContainer}>
            <Text style={emailStyles.logo}>{companyName}</Text>
          </Section>

          <Heading style={emailStyles.heading}>{title}</Heading>

          <Text style={emailStyles.text}>Hi {userFullName},</Text>

          <Text style={emailStyles.text}>{instructionText}</Text>

          <Section style={emailStyles.codeContainer}>
            <Text style={emailStyles.code}>{otpCode}</Text>
          </Section>

          <Text style={emailStyles.text}>
            This code will expire in 10 minutes. If you did not request this,
            please ignore this email.
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

export default OtpEmailTemplate;
