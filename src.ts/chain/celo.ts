import { AddressLike, getAddress } from "../address";
import { Signature, keccak256 } from "../crypto";
import { PerformActionRequest, PreparedTransactionRequest, TransactionRequest } from "../providers";
import { JsonRpcRequestBody } from "../providers/provider-jsonrpc";
import { Transaction, TransactionLike } from "../transaction";
import { formatAccessList, formatNumber, handleAccessList, handleAddress, handleNumber, handleUint, parseEipSignature } from "../transaction/transaction";
import { assert, assertArgument, concat, decodeRlp, encodeRlp, getBytes, hexlify, toBeArray } from "../utils";

export const CIP_64_TYPE_NUMBER = 123;
export const CIP_64_TYPE_HEX = "0x7b";

interface CeloTransactionLike extends TransactionLike {
    feeCurrency?: string;
}

interface CeloTransactionRequest extends TransactionRequest {
    feeCurrency?: string;
}

interface CeloPreparedTransactionRequest extends PreparedTransactionRequest {
    feeCurrency?: AddressLike;
}

export class Cip64Transaction extends Transaction {
    #feeCurrency: string = "";

    set feeCurrency(value: string) {
        this.#feeCurrency = getAddress(value);
    }

    get feeCurrency(): string {
        return this.#feeCurrency;
    }

    get type(): number { return CIP_64_TYPE_NUMBER; }

    get typeName(): null | string {
        return "cip-64";
    }

    get unsignedSerialized(): string {
        return this.serialize();
    }

    get serialized(): string {
        assert(this.signature != null, "cannot serialize unsigned transaction; maybe you meant .unsignedSerialized", "UNSUPPORTED_OPERATION", { operation: ".serialized" });

        return this.serialize(this.signature);
    }

    private serialize(signature?: Signature) {
        const fields: Array<any> = [
            formatNumber(this.chainId || 0, "chainId"),
            formatNumber(this.nonce || 0, "nonce"),
            formatNumber(this.maxPriorityFeePerGas || 0, "maxPriorityFeePerGas"),
            formatNumber(this.maxFeePerGas || 0, "maxFeePerGas"),
            formatNumber(this.gasLimit || 0, "gasLimit"),
            ((this.to != null) ? getAddress(this.to) : "0x"),
            formatNumber(this.value || 0, "value"),
            (this.data || "0x"),
            (formatAccessList(this.accessList || [])),
            getAddress(this.feeCurrency!)
        ];

        if (signature) {
            fields.push(formatNumber(signature.yParity, "yParity"));
            fields.push(toBeArray(signature.r));
            fields.push(toBeArray(signature.s));
        }

        return concat([CIP_64_TYPE_HEX, encodeRlp(fields)]);
    }

    public static parseCip64(data: Uint8Array): CeloTransactionLike {
        const fields: any = decodeRlp(getBytes(data).slice(1));

        assertArgument(Array.isArray(fields) && (fields.length === 10 || fields.length === 13),
            "invalid field count for transaction type: CIP_64_TYPE_NUMBER", "data", hexlify(data));

        const maxPriorityFeePerGas = handleUint(fields[2], "maxPriorityFeePerGas");
        const maxFeePerGas = handleUint(fields[3], "maxFeePerGas");
        const tx: CeloTransactionLike = {
            type: CIP_64_TYPE_NUMBER,
            chainId: handleUint(fields[0], "chainId"),
            nonce: handleNumber(fields[1], "nonce"),
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            maxFeePerGas: maxFeePerGas,
            gasPrice: null,
            gasLimit: handleUint(fields[4], "gasLimit"),
            to: handleAddress(fields[5]),
            value: handleUint(fields[6], "value"),
            data: hexlify(fields[7]),
            accessList: handleAccessList(fields[8], "accessList"),
            feeCurrency: handleAddress(fields[9]) || undefined
        };

        // Unsigned CIP-64 Transaction
        if (fields.length === 10) { return tx; }

        tx.hash = keccak256(data);

        parseEipSignature(tx, fields.slice(10));

        return tx;
    }
}

export const celoAlfajores = {
    populateTransaction: (tx: CeloTransactionRequest) => {
        if (tx.feeCurrency) {
            tx.type = CIP_64_TYPE_NUMBER;
        }

        return tx as CeloTransactionLike;
    },
    prepareTransactionRequest: (request: CeloTransactionRequest) => {
        const result: CeloPreparedTransactionRequest = {};
        
        if (request.feeCurrency) {
            result.feeCurrency = getAddress(request.feeCurrency);
        }

        return result;
    },
    createTransaction: (from: TransactionLike | string): Transaction => {
        if (!from) {
            return new Transaction();
        }

        if (from instanceof Cip64Transaction) {
            return from;
        }

        if (typeof from === "string") {
            const payload = getBytes(from);

            switch (payload[0]) {
                case CIP_64_TYPE_NUMBER: return celoAlfajores.createTransaction(Cip64Transaction.parseCip64(payload));
            }

            return Transaction.from(from);
        }

        if (from.type === CIP_64_TYPE_NUMBER && (from as CeloTransactionLike).feeCurrency) {
            const transaction = new Cip64Transaction();

            transaction.feeCurrency = (from as CeloTransactionLike).feeCurrency as string;

            if (from.to != null) { transaction.to = from.to; }
            if (from.nonce != null) { transaction.nonce = from.nonce; }
            if (from.gasLimit != null) { transaction.gasLimit = from.gasLimit; }
            if (from.gasPrice != null) { transaction.gasPrice = from.gasPrice; }
            if (from.maxPriorityFeePerGas != null) { transaction.maxPriorityFeePerGas = from.maxPriorityFeePerGas; }
            if (from.maxFeePerGas != null) { transaction.maxFeePerGas = from.maxFeePerGas; }
            if (from.data != null) { transaction.data = from.data; }
            if (from.value != null) { transaction.value = from.value; }
            if (from.chainId != null) { transaction.chainId = from.chainId; }
            if (from.signature != null) { transaction.signature = Signature.from(from.signature); }
            if (from.accessList != null) { transaction.accessList = from.accessList; }

            return transaction;
        }

        // Fallback to default
        return Transaction.from(<TransactionLike<string>>from);
    },
    getRpcRequest: (request: JsonRpcRequestBody | null, context: PerformActionRequest): JsonRpcRequestBody | null => {
        if (request !== null
            && request.method === "eth_estimateGas" 
            && context.method === "estimateGas"
            && (context.transaction as CeloTransactionRequest).feeCurrency
        ) {
            request.args[0].feeCurrency = (context.transaction as CeloTransactionRequest).feeCurrency;
        }

        return request;
    }
}
