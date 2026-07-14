export interface IRajorpayOrder {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  attempts: number;
  created_at: number;
}

export interface IRajorpayPayment {
  id: string;
  entity: string;
  status: string;
  order_id?: string;
}

export interface IRajorpayPaymentCollection {
  entity: string;
  count: number;
  items: IRajorpayPayment[];
}

export interface IRajorpayPaymentLinkPayment {
  payment_id: string;
  status: string;
}

export interface IRajorpayPaymentLink {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  accept_partial: boolean;
  description: string;
  order_id?: string;
  reference_id: string;
  short_url: string;
  status: string;
  expire_by?: number;
  created_at: number;
  payments?: IRajorpayPaymentLinkPayment[];
}

export interface IRajorpayCapturedPayment {
  orderId: string;
  paymentId: string;
}

export interface IRajorpayPaymentLinkCustomer {
  name?: string;
  email?: string;
  contact?: string;
}

export interface ICreateRajorpayPaymentLinkParams {
  amountInPaise: number;
  referenceId: string;
  description: string;
  callbackUrl: string;
  expireBy?: number;
  customer?: IRajorpayPaymentLinkCustomer;
  notes?: Record<string, string>;
}
