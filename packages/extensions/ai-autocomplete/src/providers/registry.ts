import type {
	AutocompleteContextProvider,
	AutocompleteProviderDescriptor,
} from "./types";

export class AutocompleteProviderRegistry {
	private readonly _providers = new Map<string, AutocompleteContextProvider>();

	constructor(initialProviders: readonly AutocompleteContextProvider[] = []) {
		for (const provider of initialProviders) {
			this._providers.set(provider.id, provider);
		}
	}

	registerProvider(provider: AutocompleteContextProvider): () => void {
		this._providers.set(provider.id, provider);
		return () => {
			if (this._providers.get(provider.id) === provider) {
				this._providers.delete(provider.id);
			}
		};
	}

	listProviders(): readonly AutocompleteContextProvider[] {
		return Array.from(this._providers.values()).sort((left, right) => {
			const leftPriority = left.priority ?? 0;
			const rightPriority = right.priority ?? 0;
			return rightPriority - leftPriority || left.id.localeCompare(right.id);
		});
	}

	listProviderDescriptors(): readonly AutocompleteProviderDescriptor[] {
		return this.listProviders().map((provider) => {
			const described = provider.describe?.();
			return described ?? {
				id: provider.id,
				description: provider.id,
			};
		});
	}
}
