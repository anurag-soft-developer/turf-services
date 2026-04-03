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

interface PasswordResetEmailProps {
  userFullName: string;
  otpCode: string;
  companyName?: string;
}

export const PasswordResetEmail = ({
  userFullName = 'User',
  otpCode = '123456',
  companyName = config.APP_NAME,
}: PasswordResetEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Section style={emailStyles.logoContainer}>
            <Text style={emailStyles.logo}>{companyName}</Text>
          </Section>
          
          <Heading style={emailStyles.heading}>Reset Your Password</Heading>
          
          <Text style={emailStyles.text}>Hi {userFullName},</Text>
          
          <Text style={emailStyles.text}>
            We received a request to reset your password. Use the following code to reset your password:
          </Text>
          
          <Section style={emailStyles.codeContainer}>
            <Text style={emailStyles.code}>{otpCode}</Text>
          </Section>
          
          <Text style={emailStyles.text}>
            This code will expire in 10 minutes. If you didn't request a password reset, please ignore this email.
          </Text>
          
          <Hr style={emailStyles.hr} />
          
          <Text style={emailStyles.footer}>
            Best regards,<br />
            The {companyName} Team
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default PasswordResetEmail;