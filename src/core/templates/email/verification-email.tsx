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

interface VerificationEmailProps {
  userFullName: string;
  otpCode: string;
  companyName?: string;
}

export const VerificationEmail = ({
  userFullName = 'User',
  otpCode = '123456',
  companyName = config.APP_NAME,
}: VerificationEmailProps) => {
  return (
    <Html>
      <Head />
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Section style={emailStyles.logoContainer}>
            <Text style={emailStyles.logo}>{companyName}</Text>
          </Section>
          
          <Heading style={emailStyles.heading}>Verify Your Email Address</Heading>
          
          <Text style={emailStyles.text}>Hi {userFullName},</Text>
          
          <Text style={emailStyles.text}>
            Welcome to {companyName}! Please verify your email address by entering the following code:
          </Text>
          
          <Section style={emailStyles.codeContainer}>
            <Text style={emailStyles.code}>{otpCode}</Text>
          </Section>
          
          <Text style={emailStyles.text}>
            This code will expire in 10 minutes. If you didn't create an account with us, please ignore this email.
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

export default VerificationEmail;