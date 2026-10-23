import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { User } from '../entities/user.entity'

@Injectable()
export class UsersRepository {
    constructor(private readonly dataSource: DataSource) {}

    exists(id: string): Promise<boolean> {
        return this.dataSource.getRepository(User).existsBy({ id })
    }
}