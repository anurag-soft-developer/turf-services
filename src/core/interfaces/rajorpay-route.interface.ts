export interface IRazorpayLinkedAccount {
  id: string;
  type: string;
  status: string;
  email: string;
  reference_id?: string;
}

export interface IRazorpayProduct {
  id: string;
  product_name: string;
  activation_status: string;
  account_id: string;
}

export interface IRazorpayTransfer {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
}

export interface IRazorpayTransferResponse {
  items: IRazorpayTransfer[];
}
